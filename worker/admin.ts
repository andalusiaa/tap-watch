// Admin API (SPEC section 6.6). Everything here needs Tristan's sign-in, except login itself.
//
//   POST /api/admin/login              { password }        → sets a 30-day session cookie
//   POST /api/admin/logout
//   GET  /api/admin/session                                → { signedIn }
//   GET  /api/admin/queue                                  → photo reports and suggestions to check
//   GET  /api/admin/photo/:id                              → the photo (JPEG)
//   GET  /api/admin/pub/:id                                → the pub and every listing, removed ones too
//   POST /api/admin/pub/:id/listings   { changes }         → mark beers on or gone
//   POST /api/admin/report/:id         { action, changes? } → approve (applying changes) or reject
//   POST /api/admin/suggestion/:id     { action, … }       → approve (adding the listing or beer) or reject

import { ADMIN, LIMITS } from './config';
import { limitPerDevice } from './guard';
import { ApiError, assertSameOrigin, badRequest, isoTime, json, readJsonBody } from './http';
import { bumpCounter, deviceHash, readCounter, sameString, signToString } from './security';
import { invalidateSnapshot } from './snapshot';
import { normalise, slugify } from './text';

const COOKIE = 'tw_admin';
const CATEGORIES = new Set(['lager', 'stout', 'pale_ipa', 'bitter_cask', 'cider', 'other']);
/** D1 on the free plan allows 50 queries per request, and each change is one. */
const MAX_CHANGES = 40;

type Dispense = 'cask' | 'keg';
interface ListingChange {
  beer_id: string;
  dispense: Dispense;
  set: 'on' | 'gone';
}

const notSignedIn = () => new ApiError(401, 'signed_out', 'Please sign in again.');
const notFound = (what: string) => new ApiError(404, 'not_found', `We couldn't find that ${what}.`);
const alreadyChecked = () => new ApiError(409, 'already_checked', 'This has already been checked.');
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);

// --- Sessions ------------------------------------------------------------------------

function passwordIsSet(env: Env): boolean {
  return typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= ADMIN.minPasswordLength;
}

/** Changing the password changes this, which signs out every existing session. */
function passwordFingerprint(env: Env): Promise<string> {
  return signToString(env.APP_SECRET, `admin-password:${env.ADMIN_PASSWORD}`);
}

async function sessionValue(env: Env, expires: number): Promise<string> {
  return `${expires}.${await signToString(env.APP_SECRET, `admin-session:${expires}:${await passwordFingerprint(env)}`)}`;
}

function cookie(value: string, maxAgeSeconds: number): string {
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

async function isSignedIn(request: Request, env: Env, now: number): Promise<boolean> {
  if (!passwordIsSet(env)) return false;
  const raw = request.headers.get('Cookie') ?? '';
  const value = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value) return false;
  const expires = Number(value.split('.')[0]);
  if (!Number.isSafeInteger(expires) || expires < now) return false;
  return sameString(value, await sessionValue(env, expires));
}

async function login(request: Request, env: Env, now: number): Promise<Response> {
  assertSameOrigin(request);
  if (!passwordIsSet(env)) {
    throw new ApiError(503, 'not_set_up', "The admin password hasn't been set up yet.");
  }
  const body = await readJsonBody(request, 1_000);
  if (typeof body.password !== 'string' || body.password.length > 200) throw badRequest();

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await env.WRITE_LIMITER.limit({ key: `login:${ip}` })).success) {
    throw new ApiError(429, 'too_many', 'Too many attempts. Wait a minute and try again.');
  }
  const db = env.DB;
  const failuresKey = `admin-login-failures:${isoTime(now).slice(0, 10)}`;
  if ((await readCounter(db, failuresKey)) >= ADMIN.failuresPerDay) {
    throw new ApiError(429, 'locked', 'Signing in is paused for today after too many wrong passwords.');
  }
  const device = await deviceHash(request, env, now);
  await limitPerDevice(db, 'admin-login', device, 'hour', ADMIN.attemptsPerHour, now,
    'Too many attempts. Please try again in an hour.');

  // Compare keyed hashes so the check takes the same time however much of the password matches.
  const [given, expected] = await Promise.all([
    signToString(env.APP_SECRET, `admin-login:${body.password}`),
    signToString(env.APP_SECRET, `admin-login:${env.ADMIN_PASSWORD}`),
  ]);
  if (!sameString(given, expected)) {
    await bumpCounter(db, failuresKey, 1, now + 2 * 86_400_000).run();
    throw new ApiError(401, 'wrong_password', "That password isn't right.");
  }

  const expires = now + ADMIN.sessionMs;
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(await sessionValue(env, expires), ADMIN.sessionMs / 1000) });
}

// --- Listings ---------------------------------------------------------------------------

function parseChanges(value: unknown): ListingChange[] {
  if (!Array.isArray(value)) throw badRequest();
  if (value.length > MAX_CHANGES) {
    throw new ApiError(400, 'too_many_changes', `Please save up to ${MAX_CHANGES} changes at a time.`);
  }
  return value.map((c: unknown) => {
    const change = c as Partial<ListingChange>;
    if (!isId(change?.beer_id) || (change.dispense !== 'cask' && change.dispense !== 'keg')) throw badRequest();
    if (change.set !== 'on' && change.set !== 'gone') throw badRequest();
    return { beer_id: change.beer_id, dispense: change.dispense, set: change.set };
  });
}

/**
 * Statements that mark beers on (confirmed as of confirmedAt) or gone (removed, restorable).
 * A confirmation never moves a listing's "last checked" date backwards.
 */
async function listingStatements(
  db: D1Database,
  pubId: string,
  changes: ListingChange[],
  source: 'admin' | 'photo' | 'suggestion',
  confirmedAt: string,
  now: string,
): Promise<D1PreparedStatement[]> {
  const beerIds = [...new Set(changes.filter((c) => c.set === 'on').map((c) => c.beer_id))];
  if (beerIds.length) {
    const found = await db
      .prepare(`SELECT id FROM beers WHERE is_active = 1 AND id IN (${beerIds.map(() => '?').join(', ')})`)
      .bind(...beerIds)
      .all<{ id: string }>();
    const known = new Set(found.results.map((r) => r.id));
    const missing = beerIds.find((id) => !known.has(id));
    if (missing) throw new ApiError(400, 'unknown_beer', `"${missing}" isn't in the beer list.`);
  }

  return changes.map((c) =>
    c.set === 'on'
      ? db
          .prepare(
            `INSERT INTO listings (pub_id, beer_id, dispense, status, source, last_confirmed_at, updated_at)
             VALUES (?1, ?2, ?3, 'confirmed', ?4, ?5, ?6)
             ON CONFLICT (pub_id, beer_id, dispense) DO UPDATE SET
               status = 'confirmed',
               source = ?4,
               reported_gone_at = NULL,
               last_confirmed_at = CASE
                 WHEN last_confirmed_at IS NULL OR last_confirmed_at < ?5 THEN ?5 ELSE last_confirmed_at END,
               updated_at = ?6`,
          )
          .bind(pubId, c.beer_id, c.dispense, source, confirmedAt, now)
      : db
          .prepare(`UPDATE listings SET status = 'removed', updated_at = ? WHERE pub_id = ? AND beer_id = ? AND dispense = ?`)
          .bind(now, pubId, c.beer_id, c.dispense),
  );
}

async function pubArea(db: D1Database, pubId: string): Promise<string> {
  const pub = await db.prepare('SELECT area_id FROM pubs WHERE id = ?').bind(pubId).first<{ area_id: string }>();
  if (!pub) throw notFound('pub');
  return pub.area_id;
}

async function getPub(env: Env, pubId: string): Promise<Response> {
  const db = env.DB;
  const [pubs, listings] = await db.batch([
    db.prepare('SELECT id, name, address, postcode, area_id, operator_id, is_active FROM pubs WHERE id = ?').bind(pubId),
    db.prepare(
      `SELECT l.id, l.beer_id, b.name AS beer_name, b.category, b.is_alcohol_free, l.dispense, l.status,
              l.source, l.last_confirmed_at, l.reported_gone_at, l.updated_at
       FROM listings l JOIN beers b ON b.id = l.beer_id
       WHERE l.pub_id = ?
       ORDER BY b.name, l.dispense`,
    ).bind(pubId),
  ]);
  const pub = pubs?.results[0];
  if (!pub) throw notFound('pub');
  return json({ pub, listings: listings?.results ?? [] });
}

async function saveListings(request: Request, env: Env, pubId: string, now: number): Promise<Response> {
  const body = await readJsonBody(request, 20_000);
  const changes = parseChanges(body.changes);
  const db = env.DB;
  const area = await pubArea(db, pubId);
  const stamp = isoTime(now);
  await db.batch([
    ...(await listingStatements(db, pubId, changes, 'admin', stamp, stamp)),
    invalidateSnapshot(db, area),
  ]);
  return getPub(env, pubId);
}

// --- Queue --------------------------------------------------------------------------------

async function getQueue(env: Env): Promise<Response> {
  const db = env.DB;
  const [reports, suggestions] = await db.batch([
    db.prepare(
      `SELECT r.id, r.pub_id, p.name AS pub_name, r.note, r.created_at, r.photo_key IS NOT NULL AS has_photo
       FROM photo_reports r JOIN pubs p ON p.id = r.pub_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at
       LIMIT 50`,
    ),
    db.prepare(
      `SELECT s.id, s.pub_id, p.name AS pub_name, s.beer_id, b.name AS beer_name, s.proposed_beer_name,
              s.dispense, s.created_at
       FROM suggestions s
       LEFT JOIN pubs p ON p.id = s.pub_id
       LEFT JOIN beers b ON b.id = s.beer_id
       WHERE s.status = 'pending'
       ORDER BY s.created_at
       LIMIT 50`,
    ),
  ]);
  return json({ reports: reports?.results ?? [], suggestions: suggestions?.results ?? [] });
}

async function getPhoto(env: Env, reportId: number): Promise<Response> {
  const row = await env.DB.prepare('SELECT photo_key FROM photo_reports WHERE id = ?')
    .bind(reportId)
    .first<{ photo_key: string | null }>();
  const photo = row?.photo_key ? await env.PHOTOS.get(row.photo_key, 'arrayBuffer') : null;
  if (!photo) throw notFound('photo');
  return new Response(photo, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

async function reviewReport(request: Request, env: Env, reportId: number, now: number): Promise<Response> {
  const body = await readJsonBody(request, 20_000);
  if (body.action !== 'approve' && body.action !== 'reject') throw badRequest();
  const db = env.DB;
  const report = await db
    .prepare('SELECT id, pub_id, photo_key, status, created_at FROM photo_reports WHERE id = ?')
    .bind(reportId)
    .first<{ id: number; pub_id: string; photo_key: string | null; status: string; created_at: string }>();
  if (!report) throw notFound('photo report');
  if (report.status !== 'pending') throw alreadyChecked();

  const stamp = isoTime(now);
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE photo_reports SET status = ?, reviewed_at = ?, photo_key = NULL WHERE id = ? AND status = 'pending'`)
      .bind(body.action === 'approve' ? 'approved' : 'rejected', stamp, reportId),
  ];
  if (body.action === 'approve') {
    // Ticks count as confirmations from when the photo was taken, not from now.
    const changes = parseChanges(body.changes ?? []);
    statements.push(...(await listingStatements(db, report.pub_id, changes, 'photo', report.created_at, stamp)));
    statements.push(invalidateSnapshot(db, await pubArea(db, report.pub_id)));
  }
  await db.batch(statements);
  // The photo goes as soon as it has been checked. (The store would also expire it.)
  if (report.photo_key) await env.PHOTOS.delete(report.photo_key);
  return json({ ok: true });
}

interface NewBeer {
  name: string;
  brewery: string | null;
  category: string;
  abv: number | null;
  is_alcohol_free: boolean;
  aliases: string[];
}

function parseNewBeer(value: unknown): NewBeer {
  const b = (value ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  const brewery = typeof b.brewery === 'string' && b.brewery.trim() ? b.brewery.trim() : null;
  const abv = b.abv === null || b.abv === undefined || b.abv === '' ? null : Number(b.abv);
  const af = b.is_alcohol_free === true;
  const problem = (message: string) => new ApiError(400, 'invalid_beer', message);

  if (!name || name.length > LIMITS.maxBeerNameLength) throw problem('Give the beer a name (up to 80 characters).');
  if (brewery && brewery.length > 80) throw problem('Keep the brewery under 80 characters.');
  if (typeof b.category !== 'string' || !CATEGORIES.has(b.category)) throw problem('Choose a style for the beer.');
  if (abv !== null && !(abv >= 0 && abv <= 15)) throw problem('ABV should be between 0 and 15.');
  if (af && abv !== null && abv > 0.5) throw problem('Alcohol-free beers are 0.5% ABV or lower.');
  if (!af && abv !== null && abv <= 0.5) throw problem('A beer of 0.5% or lower should be marked alcohol-free.');
  if (!Array.isArray(b.aliases) || b.aliases.length > 12) throw problem('Up to 12 other spellings, please.');
  const aliases = [...new Set(b.aliases.map((a) => normalise(String(a))).filter((a) => a && a !== normalise(name)))];
  if (aliases.some((a) => a.length > 60)) throw problem('Keep each other spelling under 60 characters.');

  return { name, brewery, category: b.category, abv, is_alcohol_free: af, aliases };
}

async function reviewSuggestion(request: Request, env: Env, suggestionId: number, now: number): Promise<Response> {
  const body = await readJsonBody(request, 10_000);
  if (body.action !== 'approve' && body.action !== 'reject') throw badRequest();
  const db = env.DB;
  const suggestion = await db
    .prepare('SELECT id, pub_id, beer_id, dispense, status, created_at FROM suggestions WHERE id = ?')
    .bind(suggestionId)
    .first<{ id: number; pub_id: string | null; beer_id: string | null; dispense: Dispense | null; status: string; created_at: string }>();
  if (!suggestion) throw notFound('suggestion');
  if (suggestion.status !== 'pending') throw alreadyChecked();

  const stamp = isoTime(now);
  if (body.action === 'reject') {
    await db.prepare(`UPDATE suggestions SET status = 'rejected', reviewed_at = ? WHERE id = ?`).bind(stamp, suggestionId).run();
    return json({ ok: true });
  }

  const statements: D1PreparedStatement[] = [];
  let beerId: string;
  let newBeer = false;

  if (isId(body.beer_id)) {
    // The admin matched the suggestion to a beer already in the list.
    beerId = body.beer_id;
  } else if (suggestion.beer_id && body.beer === undefined) {
    beerId = suggestion.beer_id;
  } else {
    const beer = parseNewBeer(body.beer);
    beerId = slugify(beer.name);
    if (!beerId) throw new ApiError(400, 'invalid_beer', 'That name needs some letters or numbers.');
    const [sameId, names, clashes] = await db.batch<{ id?: string; name?: string; alias?: string }>([
      db.prepare('SELECT id FROM beers WHERE id = ?').bind(beerId),
      db.prepare('SELECT id, name FROM beers'),
      db.prepare(`SELECT alias FROM beer_aliases WHERE alias IN (${beer.aliases.map(() => '?').join(', ') || "''"})`).bind(...beer.aliases),
    ]);
    if (sameId?.results.length) {
      throw new ApiError(409, 'beer_exists', `"${beer.name}" is already in the beer list. Choose it instead.`);
    }
    const nameTaken = new Set((names?.results ?? []).map((r) => normalise(r.name ?? '')));
    const clash = [...(clashes?.results ?? []).map((r) => r.alias ?? ''), ...beer.aliases.filter((a) => nameTaken.has(a))][0];
    if (clash) throw new ApiError(409, 'alias_taken', `"${clash}" already belongs to another beer.`);

    statements.push(
      db.prepare(
        `INSERT INTO beers (id, name, brewery, category, abv, is_alcohol_free, is_regular, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
      ).bind(beerId, beer.name, beer.brewery, beer.category, beer.abv, beer.is_alcohol_free ? 1 : 0),
      ...beer.aliases.map((alias) => db.prepare('INSERT INTO beer_aliases (alias, beer_id) VALUES (?, ?)').bind(alias, beerId)),
    );
    newBeer = true;
  }

  if (!newBeer && !(await db.prepare('SELECT 1 FROM beers WHERE id = ? AND is_active = 1').bind(beerId).first())) {
    throw new ApiError(400, 'unknown_beer', `"${beerId}" isn't in the beer list.`);
  }

  const pubId = isId(body.pub_id) ? body.pub_id : suggestion.pub_id;
  const dispense = body.dispense === 'cask' || body.dispense === 'keg' ? body.dispense : suggestion.dispense;
  if (pubId) {
    if (!dispense) throw new ApiError(400, 'choose_dispense', 'Choose cask or keg.');
    const area = await pubArea(db, pubId);
    if (newBeer) {
      // The beer is created in this same batch, so it can't be looked up yet.
      statements.push(
        db.prepare(
          `INSERT INTO listings (pub_id, beer_id, dispense, status, source, last_confirmed_at, updated_at)
           VALUES (?, ?, ?, 'confirmed', 'suggestion', ?, ?)`,
        ).bind(pubId, beerId, dispense, suggestion.created_at, stamp),
      );
    } else {
      const change: ListingChange = { beer_id: beerId, dispense, set: 'on' };
      statements.push(...(await listingStatements(db, pubId, [change], 'suggestion', suggestion.created_at, stamp)));
    }
    statements.push(invalidateSnapshot(db, area));
  }
  if (newBeer) {
    // A new beer appears in every area's search.
    statements.push(db.prepare('UPDATE snapshot_cache SET version = version + 1'));
  }

  statements.push(
    db.prepare(`UPDATE suggestions SET status = 'approved', reviewed_at = ?, beer_id = ?, dispense = ? WHERE id = ?`)
      .bind(stamp, beerId, dispense ?? null, suggestionId),
  );
  await db.batch(statements);
  return json({ ok: true, beer_id: beerId });
}

// --- Router ---------------------------------------------------------------------------------

export async function handleAdmin(request: Request, env: Env, url: URL, now: number): Promise<Response> {
  const path = url.pathname.slice('/api/admin'.length);
  const method = request.method;

  if (path === '/login' && method === 'POST') return login(request, env, now);
  if (path === '/logout' && method === 'POST') {
    assertSameOrigin(request);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (path === '/session' && method === 'GET') {
    return json({ signedIn: await isSignedIn(request, env, now), setUp: passwordIsSet(env) });
  }

  if (!(await isSignedIn(request, env, now))) throw notSignedIn();
  if (method !== 'GET') assertSameOrigin(request);

  let m: RegExpMatchArray | null;
  if (path === '/queue' && method === 'GET') return getQueue(env);
  if ((m = path.match(/^\/photo\/(\d{1,12})$/)) && method === 'GET') return getPhoto(env, Number(m[1]));
  if ((m = path.match(/^\/pub\/([a-z0-9-]{1,80})$/)) && method === 'GET') return getPub(env, m[1] ?? '');
  if ((m = path.match(/^\/pub\/([a-z0-9-]{1,80})\/listings$/)) && method === 'POST') {
    return saveListings(request, env, m[1] ?? '', now);
  }
  if ((m = path.match(/^\/report\/(\d{1,12})$/)) && method === 'POST') return reviewReport(request, env, Number(m[1]), now);
  if ((m = path.match(/^\/suggestion\/(\d{1,12})$/)) && method === 'POST') {
    return reviewSuggestion(request, env, Number(m[1]), now);
  }
  throw new ApiError(404, 'not_found', "There's nothing at this address.");
}
