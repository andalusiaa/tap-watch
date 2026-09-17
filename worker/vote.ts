// POST /api/vote { listing_id, direction, hp, token } — "Still on?" 👍 / 👎 (SPEC section 6.3).

import { applyVote, type VoteDirection } from '../src/rules';
import type { Listing } from '../src/types';
import { LIMITS } from './config';
import { ApiError, assertSameOrigin, badRequest, isoTime, json, readJsonBody } from './http';
import { bumpCounter, checkFormToken, deviceHash, readCounter, writeBudgetKey } from './security';
import { invalidateSnapshot } from './snapshot';

interface ListingRow extends Listing {
  area_id: string;
}

const LISTING_COLUMNS = 'l.id, l.pub_id, l.beer_id, l.dispense, l.status, l.last_confirmed_at, l.reported_gone_at';

const busy = () => new ApiError(503, 'busy', 'Tap Watch is very busy today. Please try again later.');

export async function handleVote(request: Request, env: Env, now: number): Promise<Response> {
  assertSameOrigin(request);
  const body = await readJsonBody(request, 1_000);

  const listingId = body.listing_id;
  const direction = body.direction;
  if (!Number.isSafeInteger(listingId) || (listingId as number) <= 0) throw badRequest();
  if (direction !== 1 && direction !== -1) throw badRequest();

  // Bot checks. Failures look like success, so bots learn nothing.
  if (typeof body.hp !== 'string' || body.hp !== '') return json({ ok: true });
  const token = await checkFormToken(env.APP_SECRET, body.token, now);
  if (token === 'too_fast') return json({ ok: true });
  if (token === 'expired') {
    throw new ApiError(403, 'page_expired', 'This page has been open a long time. Refresh it and try again.');
  }
  if (token === 'invalid') throw badRequest();

  // Rough per-address limit at the edge, before any database work.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.WRITE_LIMITER.limit({ key: `ip:${ip}` });
  if (!success) throw new ApiError(429, 'too_many', "You're going a bit fast. Wait a minute and try again.");

  const db = env.DB;
  const budget = writeBudgetKey(now);
  if ((await readCounter(db, budget.key)) >= LIMITS.dailyWriteBudget) throw busy();

  const device = await deviceHash(request, env, now);

  const hour = isoTime(now).slice(0, 13);
  const hourly = await bumpCounter(db, `vote-hour:${device}:${hour}`, 1, now + 3_600_000).first<{ count: number }>();
  if ((hourly?.count ?? 0) > LIMITS.votesPerHour) {
    throw new ApiError(429, 'too_many', "You've voted a lot in the last hour. Please try again later.");
  }

  const since = isoTime(now - LIMITS.voteRepeatWindowMs);
  const [repeat, found] = await db.batch([
    db.prepare('SELECT 1 FROM votes WHERE listing_id = ? AND device_hash = ? AND created_at > ? LIMIT 1').bind(
      listingId,
      device,
      since,
    ),
    db.prepare(
      `SELECT ${LISTING_COLUMNS}, p.area_id FROM listings l JOIN pubs p ON p.id = l.pub_id
       WHERE l.id = ? AND p.is_active = 1`,
    ).bind(listingId),
  ]);
  if (repeat?.results.length) {
    throw new ApiError(429, 'already_voted', "You've already voted on this beer today. Thanks!");
  }
  const listing = found?.results[0] as ListingRow | undefined;
  if (!listing || (listing.status as string) === 'removed') {
    throw new ApiError(404, 'not_found', "We couldn't find that beer at this pub. It may have been removed.");
  }

  // "Removed" needs a 👎 from a different device than the one(s) that reported it gone.
  let fromDifferentDevice = true;
  if (direction === -1 && listing.status === 'reported_gone' && listing.reported_gone_at) {
    const same = await db
      .prepare('SELECT 1 FROM votes WHERE listing_id = ? AND device_hash = ? AND direction = -1 AND created_at >= ? LIMIT 1')
      .bind(listingId, device, listing.reported_gone_at)
      .first();
    fromDifferentDevice = !same;
  }

  const stamp = isoTime(now);
  const outcome = applyVote(listing, direction as VoteDirection, { now: stamp, fromDifferentDevice });
  const source = direction === 1 ? 'vote' : null;

  const results = await db.batch([
    db.prepare('INSERT INTO votes (listing_id, direction, device_hash, created_at) VALUES (?, ?, ?, ?)').bind(
      listingId,
      direction,
      device,
      stamp,
    ),
    db.prepare(
      `UPDATE listings
       SET status = ?, last_confirmed_at = ?, reported_gone_at = ?, source = COALESCE(?, source), updated_at = ?
       WHERE id = ?`,
    ).bind(outcome.status, outcome.last_confirmed_at, outcome.reported_gone_at, source, stamp, listingId),
    invalidateSnapshot(db, listing.area_id),
    bumpCounter(db, budget.key, LIMITS.voteWriteCost, budget.expiresAt),
    db.prepare(`SELECT ${LISTING_COLUMNS} FROM listings l WHERE l.id = ?`).bind(listingId),
  ]);

  const updated = results[4]?.results[0] as Listing | undefined;
  return json({ ok: true, listing: updated });
}
