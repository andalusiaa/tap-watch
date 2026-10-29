// Counting how the site is used, as daily totals and nothing else.
//
//   POST /api/count        { token, events: [{ kind, key }] }  → 204, always
//   GET  /api/admin/stats?days=30                              → the Numbers tab
//
// Every count is a row in `stats` keyed by the date, so there is nothing to tie back to a
// person: no device hash, no address, no time of day. Page views are counted on the server
// from the request each page already makes, so no extra request and nothing for an ad
// blocker to stop. Searches, pub lists and map opens come from the browser, batched.

import { ApiError, isoTime, json, readJsonBody } from './http';
import { checkFormToken } from './security';

/** What can be counted. Only the first four can be sent by a browser. */
const FROM_BROWSER = new Set(['search', 'miss', 'pub', 'map']);
const MAX_EVENTS = 10;
/** Longest search text kept. Long enough for a beer name, short enough not to be a sentence. */
const MAX_MISS = 40;
const TOP = 25;

export type StatKind = 'page' | 'search' | 'miss' | 'pub' | 'map' | 'vote' | 'photo' | 'beer' | 'message';

const day = (now: number) => isoTime(now).slice(0, 10);

/** One count, as a statement to add to whatever batch is already being written. */
export function countStat(db: D1Database, now: number, kind: StatKind, key = ''): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO stats (day, kind, key, n) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (day, kind, key) DO UPDATE SET n = n + 1`,
    )
    .bind(day(now), kind, key);
}

/** The same, but only if the beer or pub is real, so nothing made-up can fill the table. */
function countIfKnown(db: D1Database, now: number, kind: 'search' | 'pub', key: string): D1PreparedStatement {
  const table = kind === 'search' ? 'beers' : 'pubs';
  return db
    .prepare(
      `INSERT INTO stats (day, kind, key, n)
       SELECT ?1, ?2, ?3, 1 WHERE EXISTS (SELECT 1 FROM ${table} WHERE id = ?3)
       ON CONFLICT (day, kind, key) DO UPDATE SET n = n + 1`,
    )
    .bind(day(now), kind, key);
}

/**
 * Counts a page being opened. Called from the request the page makes anyway, and never
 * allowed to fail the response: a missed count matters far less than a broken page.
 */
export async function countPage(db: D1Database, now: number, page: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(page)) return;
  try {
    await countStat(db, now, 'page', page).run();
  } catch {
    // Counting is never worth an error.
  }
}

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/** Tidies search words: lower case, letters and numbers only, short. '' if nothing is left. */
function tidySearch(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value
    .toLowerCase()
    .replace(/[^a-z0-9 '&.%+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MISS)
    .trim();
  return text.length >= 2 ? text : '';
}

/**
 * Counts what the browser reports. Always answers 204, even when nothing was counted, so a
 * bot learns nothing and a visitor never sees an error from something they didn't ask for.
 */
export async function handleCount(request: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin) return noContent();

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request, 1_500);
  } catch {
    return noContent();
  }
  // A page token proves this came from a page of ours. Being quick off the mark is fine here.
  const token = await checkFormToken(env.APP_SECRET, body.token, now);
  if (token === 'invalid' || token === 'expired') return noContent();

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await env.WRITE_LIMITER.limit({ key: `count:${ip}` })).success) return noContent();

  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const db = env.DB;
  const statements: D1PreparedStatement[] = [];
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue;
    const { kind, key } = event as { kind?: unknown; key?: unknown };
    if (typeof kind !== 'string' || !FROM_BROWSER.has(kind)) continue;
    if (kind === 'map') statements.push(countStat(db, now, 'map'));
    else if (kind === 'miss') {
      const text = tidySearch(key);
      if (text) statements.push(countStat(db, now, 'miss', text));
    } else if (typeof key === 'string' && /^[a-z0-9-]{1,80}$/.test(key)) {
      statements.push(countIfKnown(db, now, kind === 'search' ? 'search' : 'pub', key));
    }
  }
  if (statements.length) await db.batch(statements);
  return noContent();
}

// --- The admin Numbers tab -------------------------------------------------------------

interface Row {
  key: string;
  n: number;
}

export async function getStats(env: Env, url: URL, now: number): Promise<Response> {
  const asked = Number(url.searchParams.get('days') ?? 30);
  const days = [7, 30, 90].includes(asked) ? asked : 30;
  if (!Number.isFinite(asked)) throw new ApiError(400, 'bad_request', 'Ask for 7, 30 or 90 days.');
  const from = day(now - (days - 1) * 86_400_000);
  const db = env.DB;

  const [daily, pages, searches, misses, pubs, firstDay] = await db.batch([
    db.prepare('SELECT day, kind, SUM(n) AS n FROM stats WHERE day >= ? GROUP BY day, kind').bind(from),
    db.prepare(`SELECT key, SUM(n) AS n FROM stats WHERE kind = 'page' AND day >= ? GROUP BY key ORDER BY n DESC`).bind(from),
    db
      .prepare(
        `SELECT s.key, SUM(s.n) AS n, b.name FROM stats s LEFT JOIN beers b ON b.id = s.key
         WHERE s.kind = 'search' AND s.day >= ? GROUP BY s.key ORDER BY n DESC LIMIT ?`,
      )
      .bind(from, TOP),
    db
      .prepare(`SELECT key, SUM(n) AS n FROM stats WHERE kind = 'miss' AND day >= ? GROUP BY key ORDER BY n DESC LIMIT ?`)
      .bind(from, TOP),
    db
      .prepare(
        `SELECT s.key, SUM(s.n) AS n, p.name FROM stats s LEFT JOIN pubs p ON p.id = s.key
         WHERE s.kind = 'pub' AND s.day >= ? GROUP BY s.key ORDER BY n DESC LIMIT ?`,
      )
      .bind(from, TOP),
    db.prepare('SELECT MIN(day) AS day FROM stats'),
  ]);

  // One row per day in the period, zeroes included, so a chart has no gaps.
  const byDay = new Map<string, Record<string, number>>();
  for (let i = days - 1; i >= 0; i--) byDay.set(day(now - i * 86_400_000), {});
  for (const row of (daily?.results ?? []) as { day: string; kind: string; n: number }[]) {
    const entry = byDay.get(row.day);
    if (entry) entry[row.kind] = row.n;
  }

  const total = (kind: string) => [...byDay.values()].reduce((sum, d) => sum + (d[kind] ?? 0), 0);
  return json({
    now: isoTime(now),
    days,
    from,
    counting_since: (firstDay?.results[0] as { day: string | null } | undefined)?.day ?? null,
    daily: [...byDay].map(([d, counts]) => ({ day: d, ...counts })),
    pages: (pages?.results ?? []) as Row[],
    searches: (searches?.results ?? []) as (Row & { name: string | null })[],
    misses: (misses?.results ?? []) as Row[],
    pubs: (pubs?.results ?? []) as (Row & { name: string | null })[],
    totals: {
      page: total('page'),
      search: total('search'),
      miss: total('miss'),
      pub: total('pub'),
      map: total('map'),
      vote: total('vote'),
      photo: total('photo'),
      beer: total('beer'),
      message: total('message'),
    },
  });
}
