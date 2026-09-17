// Checks every public write goes through before touching the database (SPEC section 9).

import { LIMITS } from './config';
import { ApiError, badRequest, isoTime } from './http';
import { bumpCounter, checkFormToken, deviceHash, readCounter, writeBudgetKey } from './security';

export interface WriteContext {
  /** Hash identifying this device (never the IP address itself). */
  device: string;
  /** Today's database write budget counter. */
  budget: { key: string; expiresAt: number };
}

export const busy = () => new ApiError(503, 'busy', 'Tap Watch is very busy today. Please try again later.');

/**
 * Returns null when the request looks like a bot: the caller should reply as if it had
 * worked and do nothing, so bots learn nothing. Throws ApiError for real problems.
 */
export async function guardPublicWrite(
  request: Request,
  env: Env,
  now: number,
  fields: { hp: unknown; token: unknown },
): Promise<WriteContext | null> {
  if (typeof fields.hp !== 'string' || fields.hp !== '') return null;
  const token = await checkFormToken(env.APP_SECRET, fields.token, now);
  if (token === 'too_fast') return null;
  if (token === 'expired') {
    throw new ApiError(403, 'page_expired', 'This page has been open a long time. Refresh it and try again.');
  }
  if (token === 'invalid') throw badRequest();

  // Rough per-address limit at the edge, before any database work.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.WRITE_LIMITER.limit({ key: `ip:${ip}` });
  if (!success) throw new ApiError(429, 'too_many', "You're going a bit fast. Wait a minute and try again.");

  const budget = writeBudgetKey(now);
  if ((await readCounter(env.DB, budget.key)) >= LIMITS.dailyWriteBudget) throw busy();

  return { device: await deviceHash(request, env, now), budget };
}

/**
 * Counts one action for this device in the current window and throws once over the limit.
 * windowKey is e.g. the hour ('2026-09-17T14') or the day ('2026-09-17').
 */
export async function limitPerDevice(
  db: D1Database,
  kind: string,
  device: string,
  window: 'hour' | 'day',
  limit: number,
  now: number,
  message: string,
) {
  const stamp = isoTime(now).slice(0, window === 'hour' ? 13 : 10);
  const ttl = window === 'hour' ? 3_600_000 : 86_400_000;
  const row = await bumpCounter(db, `${kind}:${device}:${stamp}`, 1, now + ttl).first<{ count: number }>();
  if ((row?.count ?? 0) > limit) throw new ApiError(429, 'too_many', message);
}
