// The feedback box in the footer, and the admin side of it.
//
//   POST /api/feedback                { message, hp, token }
//   GET  /api/admin/feedback                                   → pending messages and kept ideas
//   POST /api/admin/feedback/:id      { action: 'keep' | 'reject' }
//
// Keeping a message stores it as an idea to come back to; rejecting discards it for good.

import { logAdmin } from './activity';
import { LIMITS } from './config';
import { guardPublicWrite, limitPerDevice } from './guard';
import { ApiError, assertSameOrigin, badRequest, isoTime, json, readJsonBody } from './http';
import { bumpCounter } from './security';

export async function handleFeedback(request: Request, env: Env, now: number): Promise<Response> {
  assertSameOrigin(request);
  const body = await readJsonBody(request, 4_000);

  const guard = await guardPublicWrite(request, env, now, { hp: body.hp, token: body.token });
  if (!guard) return json({ ok: true });

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) throw new ApiError(400, 'empty', 'Please write a message first.');
  if (message.length > LIMITS.maxFeedbackLength) {
    throw new ApiError(400, 'too_long', `Please keep it under ${LIMITS.maxFeedbackLength} characters.`);
  }

  const db = env.DB;
  await limitPerDevice(db, 'feedback-day', guard.device, 'day', LIMITS.feedbackPerDay, now,
    "You've sent a few messages today. Thanks! Please try again tomorrow.");
  await db.batch([
    db.prepare('INSERT INTO feedback (message, status, device_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(message, 'pending', guard.device, isoTime(now)),
    bumpCounter(db, guard.budget.key, LIMITS.feedbackWriteCost, guard.budget.expiresAt),
  ]);
  return json({ ok: true });
}

export async function getFeedback(env: Env): Promise<Response> {
  const db = env.DB;
  const [pending, kept] = await db.batch([
    db.prepare(`SELECT id, message, created_at FROM feedback WHERE status = 'pending' ORDER BY created_at LIMIT 50`),
    db.prepare(`SELECT id, message, created_at, reviewed_at FROM feedback WHERE status = 'kept' ORDER BY reviewed_at DESC LIMIT 100`),
  ]);
  return json({ pending: pending?.results ?? [], kept: kept?.results ?? [] });
}

export async function reviewFeedback(request: Request, env: Env, id: number, now: number): Promise<Response> {
  const body = await readJsonBody(request, 500);
  if (body.action !== 'keep' && body.action !== 'reject') throw badRequest();
  const db = env.DB;
  const row = await db.prepare('SELECT id, status, message FROM feedback WHERE id = ?').bind(id)
    .first<{ id: number; status: string; message: string }>();
  if (!row) throw new ApiError(404, 'not_found', "We couldn't find that message.");
  if (row.status !== 'pending') throw new ApiError(409, 'already_checked', 'This has already been checked.');

  const keep = body.action === 'keep';
  await db.batch([
    db.prepare(`UPDATE feedback SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`)
      .bind(keep ? 'kept' : 'rejected', isoTime(now), id),
    logAdmin(db, now, keep ? 'feedback_kept' : 'feedback_rejected', null,
      `${keep ? 'Kept' : 'Discarded'} feedback: "${row.message.slice(0, 120)}"`),
  ]);
  // Nothing is gained by holding on to a rejected message.
  if (!keep) await db.prepare('DELETE FROM feedback WHERE id = ? AND status = ?').bind(id, 'rejected').run();
  return json({ ok: true });
}
