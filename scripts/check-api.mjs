// Checks the vote rules against the LOCAL API (SPEC sections 6.3, 8, 9 and 14).
//
// Usage: npm run dev:api   (in one terminal)
//        npm run check:api (in another)
//
// It changes the local database, so run `npm run db:seed:local` afterwards for a fresh start.
// Never point it at the live site.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API)) throw new Error('Local API only');

const secret = /^APP_SECRET=(.+)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1];
if (!secret) throw new Error('APP_SECRET missing from .dev.vars');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✓' : '✗'} ${name}${condition ? '' : `  ${detail}`}`);
  if (!condition) failures++;
}

function sql(command) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'tap-watch', '--local', '--json', '--command', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].results;
}

async function signedToken(issuedAt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`form:${issuedAt}`)));
  return `${issuedAt}.${Buffer.from(sig).toString('base64url')}`;
}

async function freshToken() {
  const res = await fetch(`${API}/api/snapshot?area=e17`);
  return res.headers.get('X-Form-Token');
}

// Each "device" gets its own address too, so the per-address flood limit doesn't
// interfere with the per-device rules being checked.
let deviceCount = 0;
function device(name) {
  const ip = `203.0.113.${++deviceCount}`;
  return (body, token) =>
    fetch(`${API}/api/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: API,
        'User-Agent': `check-api ${name}`,
        'CF-Connecting-IP': ip,
      },
      body: JSON.stringify({ hp: '', token, ...body }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

const listingWith = (status) => sql(`SELECT id FROM listings WHERE status = '${status}' ORDER BY id LIMIT 3`).map((r) => r.id);
const listing = (id) => sql(`SELECT status, last_confirmed_at, reported_gone_at, source FROM listings WHERE id = ${id}`)[0];

const alice = device('alice');
const bob = device('bob');
const carol = device('carol');

// --- Bot checks ------------------------------------------------------------------
const [likely] = listingWith('likely');
const [confirmedA, confirmedB] = listingWith('confirmed');
const [gone] = listingWith('reported_gone');

let token = await freshToken();
let r = await alice({ listing_id: likely, direction: 1 }, token);
check('Too-fast vote looks accepted but changes nothing', r.status === 200 && !r.body.listing && listing(likely).status === 'likely', JSON.stringify(r));

await sleep(2_100);
r = await alice({ listing_id: likely, direction: 1, hp: 'http://spam.example' }, token);
check('Honeypot vote looks accepted but changes nothing', r.status === 200 && !r.body.listing && listing(likely).status === 'likely', JSON.stringify(r));

r = await alice({ listing_id: likely, direction: 1 }, 'not-a-token');
check('Forged token is refused', r.status === 400, JSON.stringify(r));

r = await alice({ listing_id: likely, direction: 1 }, await signedToken(Date.now() - 13 * 3_600_000));
check('Expired page token asks for a refresh', r.status === 403 && r.body.error === 'page_expired', JSON.stringify(r));

r = await alice({ listing_id: likely, direction: 2 }, token);
check('Invalid direction is refused', r.status === 400, JSON.stringify(r));

// --- Vote rules ------------------------------------------------------------------
r = await alice({ listing_id: likely, direction: 1 }, token);
let row = listing(likely);
check('👍 on "likely" confirms it and sets the date', r.status === 200 && row.status === 'confirmed' && Date.now() - Date.parse(row.last_confirmed_at) < 60_000 && row.source === 'vote', JSON.stringify({ r, row }));
check('Response carries the updated listing', r.body.listing?.status === 'confirmed', JSON.stringify(r.body));

r = await alice({ listing_id: likely, direction: -1 }, token);
check('Same device can\'t vote on the same beer again within 24 hours', r.status === 429 && r.body.error === 'already_voted', JSON.stringify(r));

r = await alice({ listing_id: confirmedA, direction: -1 }, token);
row = listing(confirmedA);
check('👎 marks a beer as reported gone', r.status === 200 && row.status === 'reported_gone' && row.reported_gone_at, JSON.stringify({ r, row }));

r = await bob({ listing_id: confirmedA, direction: -1 }, token);
row = listing(confirmedA);
check('A second 👎 from a different device removes it', r.status === 200 && row.status === 'removed', JSON.stringify({ r, row }));

r = await carol({ listing_id: confirmedA, direction: 1 }, token);
check('Removed beers can\'t be voted on', r.status === 404, JSON.stringify(r));

r = await bob({ listing_id: gone, direction: 1 }, token);
row = listing(gone);
check('👍 on "reported gone" confirms it and clears the gone date', r.status === 200 && row.status === 'confirmed' && row.reported_gone_at === null, JSON.stringify({ r, row }));

r = await carol({ listing_id: 99_999_999, direction: 1 }, token);
check('Unknown listing gives a friendly 404', r.status === 404 && typeof r.body.message === 'string', JSON.stringify(r));

// --- Limits ------------------------------------------------------------------------
const flooder = device('flooder');
const codes = [];
for (let i = 0; i < 25; i++) {
  const res = await flooder({ listing_id: confirmedB, direction: 1 }, token);
  codes.push(res.body.error ?? res.status);
}
check('Rapid-fire requests from one address are slowed down', codes.includes('too_many'), codes.join(','));

// --- Housekeeping ------------------------------------------------------------------
const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
sql(`INSERT INTO votes (listing_id, direction, device_hash, created_at) VALUES (${likely}, 1, 'feedfacefeedfacefeedfacefeedface', '${old}')`);
sql(`INSERT INTO rate_limits (key, count, expires_at) VALUES ('check-api:expired', 1, '${old}')`);
const cron = await fetch(`${API}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('17 3 * * *')}`);
await sleep(500);
check('Daily clean-up runs', cron.ok, String(cron.status));
check('Clean-up clears device hashes older than 30 days', sql(`SELECT device_hash FROM votes WHERE created_at = '${old}'`)[0]?.device_hash === null);
check('Clean-up deletes expired counters', sql("SELECT 1 FROM rate_limits WHERE key = 'check-api:expired'").length === 0);
check('Recent votes keep their hash', sql('SELECT COUNT(*) AS n FROM votes WHERE device_hash IS NOT NULL')[0].n > 0);

// --- Privacy -------------------------------------------------------------------------
const hashes = sql('SELECT DISTINCT device_hash FROM votes WHERE device_hash IS NOT NULL').map((v) => v.device_hash);
check('Votes store a hash, never an IP address', hashes.length > 0 && hashes.every((h) => /^[0-9a-f]{32}$/.test(h)), hashes.join(','));
const dump = JSON.stringify(sql('SELECT * FROM votes')) + JSON.stringify(sql('SELECT * FROM rate_limits'));
check('No IP address appears in the votes or counters', !dump.includes('203.0.113.'), '');

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
