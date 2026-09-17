// Bot checks, device hashes and rate-limit counters (SPEC section 9).
// The visitor's IP address is only ever held in memory while a hash is made.

import { LIMITS, PRIVACY } from './config';
import { isoTime } from './http';

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;
let keySecret = '';

function hmacKey(secret: string): Promise<CryptoKey> {
  if (!keyPromise || keySecret !== secret) {
    keySecret = secret;
    keyPromise = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
  }
  return keyPromise;
}

async function sign(secret: string, message: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message)));
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// --- Page tokens ---------------------------------------------------------------
// Handed out with the snapshot, sent back with every write. They prove the request came
// from a page that has been open at least a couple of seconds.

export async function issueFormToken(secret: string, now: number): Promise<string> {
  const issued = String(now);
  return `${issued}.${toBase64Url(await sign(secret, `form:${issued}`))}`;
}

export type FormTokenCheck = 'ok' | 'too_fast' | 'expired' | 'invalid';

export async function checkFormToken(secret: string, token: unknown, now: number): Promise<FormTokenCheck> {
  if (typeof token !== 'string' || token.length > 100) return 'invalid';
  const [issued, signature, extra] = token.split('.');
  if (!issued || !signature || extra !== undefined || !/^\d{13}$/.test(issued)) return 'invalid';
  let valid: boolean;
  try {
    // verify() compares in constant time.
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), encoder.encode(`form:${issued}`));
  } catch {
    return 'invalid';
  }
  if (!valid) return 'invalid';
  const age = now - Number(issued);
  if (age < LIMITS.minFormAgeMs) return 'too_fast';
  if (age > LIMITS.maxFormAgeMs) return 'expired';
  return 'ok';
}

// --- Device hashes -------------------------------------------------------------

let cachedSalt: { salt: string; loadedAt: number } | null = null;
const SALT_MEMORY_MS = 10 * 60_000;

/** Makes a new salt and deletes the old ones. Returns the newest salt. */
export async function rotateSalt(db: D1Database, now: number): Promise<string> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const [, , latest] = await db.batch<{ salt: string }>([
    db.prepare('INSERT INTO device_salts (salt, created_at) VALUES (?, ?)').bind(salt, isoTime(now)),
    db.prepare('DELETE FROM device_salts WHERE id < (SELECT MAX(id) FROM device_salts)'),
    db.prepare('SELECT salt FROM device_salts ORDER BY id DESC LIMIT 1'),
  ]);
  const newest = latest?.results[0]?.salt ?? salt;
  cachedSalt = { salt: newest, loadedAt: now };
  return newest;
}

async function currentSalt(db: D1Database, now: number): Promise<string> {
  if (cachedSalt && now - cachedSalt.loadedAt < SALT_MEMORY_MS) return cachedSalt.salt;
  const row = await db
    .prepare('SELECT salt, created_at FROM device_salts ORDER BY id DESC LIMIT 1')
    .first<{ salt: string; created_at: string }>();
  if (!row || now - Date.parse(row.created_at) > PRIVACY.saltMaxAgeMs) return rotateSalt(db, now);
  cachedSalt = { salt: row.salt, loadedAt: now };
  return row.salt;
}

/**
 * HMAC-SHA-256 of (salt, IP address, browser). The secret key lives in a Cloudflare
 * secret and the salt in the database, so neither alone can reverse a hash.
 */
export async function deviceHash(request: Request, env: Env, now: number): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const browser = (request.headers.get('User-Agent') ?? '').slice(0, 512);
  const salt = await currentSalt(env.DB, now);
  return toHex(await sign(env.APP_SECRET, `device:${salt}:${ip}:${browser}`)).slice(0, 32);
}

// --- Counters --------------------------------------------------------------------

export function bumpCounter(db: D1Database, key: string, amount: number, expiresAt: number) {
  return db
    .prepare(
      `INSERT INTO rate_limits (key, count, expires_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET count = count + ?2
       RETURNING count`,
    )
    .bind(key, amount, isoTime(expiresAt));
}

export async function readCounter(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare('SELECT count FROM rate_limits WHERE key = ?').bind(key).first<{ count: number }>();
  return row?.count ?? 0;
}

/** Key and expiry for today's database write budget. */
export function writeBudgetKey(now: number) {
  const day = isoTime(now).slice(0, 10);
  return { key: `writes:${day}`, expiresAt: Date.parse(`${day}T00:00:00Z`) + 2 * 86_400_000 };
}
