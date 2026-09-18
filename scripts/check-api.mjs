// Checks the vote rules against the LOCAL API (SPEC sections 6.3, 8, 9 and 14).
//
// Usage, on a fresh local database:
//   npm run db:reset:local   (with dev:api stopped)
//   npm run dev:api          (in one terminal)
//   npm run check:api        (in another)
//
// It changes the local database, so reset it before running again. Never point it at the live site.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API)) throw new Error('Local API only');

const devVars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const secret = /^APP_SECRET=(.+)$/m.exec(devVars)?.[1];
const adminPassword = /^ADMIN_PASSWORD=(.+)$/m.exec(devVars)?.[1];
if (!secret || !adminPassword) throw new Error('APP_SECRET or ADMIN_PASSWORD missing from .dev.vars');

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

// --- Photo reports ------------------------------------------------------------------
// A tiny JPEG-shaped file with an EXIF block (where phones keep GPS location).
const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x16]), Buffer.from('Exif\0\0GPS-51.5,-0.02')]);
const fakeJpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  exif,
  Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  Buffer.from('image-data'),
  Buffer.from([0xff, 0xd9]),
]);

function reporter(name) {
  const ip = `203.0.113.${++deviceCount}`;
  return (fields, file = { bytes: fakeJpeg, type: 'image/jpeg' }, copies = 1) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ hp: '', token, ...fields })) form.set(k, v);
    for (let i = 0; i < copies && file; i++) form.append('photo', new Blob([file.bytes], { type: file.type }), `taps-${i + 1}.jpg`);
    return fetch(`${API}/api/report`, {
      method: 'POST',
      headers: { Origin: API, 'User-Agent': `check-api ${name}`, 'CF-Connecting-IP': ip },
      body: form,
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
  };
}
const photographer = reporter('photographer');
const pubId = sql("SELECT id FROM pubs WHERE is_active = 1 ORDER BY id LIMIT 1")[0].id;
const reportsBefore = sql('SELECT COUNT(*) AS n FROM photo_reports')[0].n;

r = await photographer({ pub_id: pubId, note: 'Taps by the window' }, undefined, 2);
check('A report with two photos is accepted', r.status === 200 && r.body.ok, JSON.stringify(r));
r = await photographer({ pub_id: pubId }, { bytes: Buffer.from('<svg></svg>'), type: 'image/svg+xml' });
check('Non-JPEG files are refused', r.status === 400 && r.body.error === 'not_a_photo', JSON.stringify(r));
r = await photographer({ pub_id: pubId }, { bytes: Buffer.from('not really a jpeg'), type: 'image/jpeg' });
check('Files that only claim to be JPEG are refused', r.status === 400, JSON.stringify(r));
r = await photographer({ pub_id: 'no-such-pub' });
check('Photos for unknown pubs are refused', r.status === 404, JSON.stringify(r));
r = await photographer({ pub_id: pubId }, undefined, 5);
check('More than four photos at once are refused', r.status === 400 && r.body.error === 'too_many_photos', JSON.stringify(r));
r = await photographer({ pub_id: pubId, hp: 'bot' });
check('Honeypot photo looks accepted but is not stored', r.status === 200 && sql('SELECT COUNT(*) AS n FROM photo_reports')[0].n === reportsBefore + 1, JSON.stringify(r));
for (let i = 0; i < 4; i++) await photographer({ pub_id: pubId });
r = await photographer({ pub_id: pubId });
check('A sixth photo from one device in a day is refused', r.status === 429, JSON.stringify(r));
const report = sql("SELECT id, pub_id, device_hash, note FROM photo_reports ORDER BY id LIMIT 1")[0];
const reportImages = sql(`SELECT position, photo_key FROM photo_report_images WHERE report_id = ${report.id} ORDER BY position`);
check('Report stores both photos, a device hash and the note', reportImages.length === 2 && reportImages.every((i) => i.photo_key?.startsWith('reports/')) && /^[0-9a-f]{32}$/.test(report.device_hash) && report.note === 'Taps by the window', JSON.stringify({ report, reportImages }));

// --- Suggestions ---------------------------------------------------------------------
const suggester = device('suggester');
const suggest = (body) =>
  fetch(`${API}/api/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API, 'User-Agent': 'check-api suggester', 'CF-Connecting-IP': '203.0.113.200' },
    body: JSON.stringify({ hp: '', token, ...body }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
void suggester;
r = await suggest({ pub_id: pubId, beer_id: 'lucky-saint', dispense: 'keg' });
check('Suggestion of a listed beer is accepted', r.status === 200, JSON.stringify(r));
r = await suggest({ pub_id: pubId, proposed_beer_name: '  Walthamstow   Wonder  ', dispense: 'cask' });
check('Suggestion of a new beer is accepted', r.status === 200, JSON.stringify(r));
r = await suggest({ pub_id: pubId, dispense: 'keg' });
check('Suggestion without a beer is refused', r.status === 400, JSON.stringify(r));
r = await suggest({ pub_id: pubId, beer_id: 'lucky-saint', dispense: 'bottle' });
check('Bottles are refused (draught only)', r.status === 400, JSON.stringify(r));
r = await suggest({ pub_id: pubId, proposed_beer_name: 'x'.repeat(81) });
check('Over-long beer names are refused', r.status === 400, JSON.stringify(r));
const proposed = sql("SELECT proposed_beer_name FROM suggestions WHERE beer_id IS NULL")[0]?.proposed_beer_name;
check('Proposed names are tidied', proposed === 'Walthamstow Wonder', String(proposed));

// --- Admin ---------------------------------------------------------------------------
const adminHeaders = (cookie = '', ip = '203.0.113.250') => ({
  'Content-Type': 'application/json',
  Origin: API,
  'User-Agent': 'check-api admin',
  'CF-Connecting-IP': ip,
  ...(cookie ? { Cookie: cookie } : {}),
});
const admin = (path, { body, cookie, origin = API } = {}) =>
  fetch(`${API}/api/admin${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...adminHeaders(cookie), Origin: origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer() }));

r = await admin('/session');
check('Admin session starts signed out', r.status === 200 && r.body.signedIn === false && r.body.setUp === true, JSON.stringify(r.body));
r = await admin('/queue');
check('Admin pages refuse visitors who are not signed in', r.status === 401, JSON.stringify(r.body));
r = await admin('/login', { body: { password: 'wrong password!' } });
check('Wrong password is refused', r.status === 401 && r.body.error === 'wrong_password', JSON.stringify(r.body));
r = await admin('/login', { body: { password: adminPassword }, origin: 'https://evil.example' });
check('Sign-in from another website is refused', r.status === 403, JSON.stringify(r.body));
r = await admin('/login', { body: { password: adminPassword } });
const setCookie = r.headers.get('set-cookie') ?? '';
const cookie = setCookie.split(';')[0];
check('Right password signs in with a secure session cookie', r.status === 200 && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie), setCookie);
check('Session cookie is accepted', (await admin('/session', { cookie })).body.signedIn === true);
const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
check('A tampered session cookie is refused', (await admin('/queue', { cookie: forged })).status === 401);

r = await admin('/queue', { cookie });
check('Queue lists the photos and both suggestions', r.status === 200 && r.body.reports[0]?.photo_count === 2 && r.body.suggestions.length === 2, JSON.stringify(r.body).slice(0, 300));

r = await admin('/usage', { cookie });
check('Usage counts today\'s photos, report and stored bytes', r.status === 200 && r.body.today.photos >= 2 && r.body.today.reports >= 1 && r.body.stored_photos.count >= 2 && r.body.stored_photos.bytes > 0 && r.body.days.length === 7 && r.body.today.writes > 0, JSON.stringify(r.body).slice(0, 300));
check('Usage needs sign-in', (await admin('/usage')).status === 401);

r = await admin(`/photo/${report.id}/1`, { cookie });
const photoBytes = Buffer.from(r.body);
check('Admin can view the photo', r.status === 200 && r.headers.get('content-type') === 'image/jpeg');
check('The stored photo has its EXIF location data removed', photoBytes[0] === 0xff && photoBytes[1] === 0xd8 && !photoBytes.includes(Buffer.from('Exif')) && photoBytes.includes(Buffer.from('image-data')), photoBytes.toString('latin1'));

// Approve the photo, marking one beer on and one gone.
const [gonePick] = sql(`SELECT beer_id, dispense FROM listings WHERE pub_id = '${report.pub_id}' AND status != 'removed' LIMIT 1`);
r = await admin(`/report/${report.id}`, {
  cookie,
  body: { action: 'approve', changes: [{ beer_id: 'thatchers-zero', dispense: 'keg', set: 'on' }, { ...gonePick, set: 'gone' }] },
});
check('Approving a photo saves the ticks', r.status === 200, JSON.stringify(r.body));
const onRow = sql(`SELECT status, source, last_confirmed_at FROM listings WHERE pub_id = '${report.pub_id}' AND beer_id = 'thatchers-zero'`)[0];
const reportRow = sql(`SELECT status, created_at FROM photo_reports WHERE id = ${report.id}`)[0];
check('A ticked beer is confirmed as of when the photo was taken', onRow?.status === 'confirmed' && onRow.source === 'photo' && onRow.last_confirmed_at === reportRow.created_at, JSON.stringify({ onRow, reportRow }));
check('An unticked beer is removed', sql(`SELECT status FROM listings WHERE pub_id = '${report.pub_id}' AND beer_id = '${gonePick.beer_id}' AND dispense = '${gonePick.dispense}'`)[0]?.status === 'removed');
const keysLeft = sql(`SELECT COUNT(*) AS n FROM photo_report_images WHERE report_id = ${report.id} AND photo_key IS NOT NULL`)[0].n;
check('The report is marked approved and its photo keys cleared', reportRow.status === 'approved' && keysLeft === 0, JSON.stringify({ reportRow, keysLeft }));
check('Both photos themselves are deleted', (await admin(`/photo/${report.id}/1`, { cookie })).status === 404 && (await admin(`/photo/${report.id}/2`, { cookie })).status === 404);
check('A report cannot be decided twice', (await admin(`/report/${report.id}`, { cookie, body: { action: 'reject' } })).status === 409);

// Suggestions: approve the listed beer, add the new one as a new beer.
const [known, fresh] = sql('SELECT id, beer_id FROM suggestions ORDER BY id');
r = await admin(`/suggestion/${known.id}`, { cookie, body: { action: 'approve' } });
check('Approving a suggestion adds the beer to the pub', r.status === 200 && sql(`SELECT status, source FROM listings WHERE pub_id = '${pubId}' AND beer_id = 'lucky-saint' AND dispense = 'keg'`)[0]?.status === 'confirmed', JSON.stringify(r.body));
r = await admin(`/suggestion/${fresh.id}`, { cookie, body: { action: 'approve', beer: { name: 'Walthamstow Wonder', brewery: 'Test Brewery', category: 'pale_ipa', abv: 0.4, is_alcohol_free: false, aliases: [] } } });
check('Inconsistent alcohol-free details are refused', r.status === 400 && r.body.error === 'invalid_beer', JSON.stringify(r.body));
r = await admin(`/suggestion/${fresh.id}`, { cookie, body: { action: 'approve', beer: { name: 'Walthamstow Wonder', brewery: 'Test Brewery', category: 'pale_ipa', abv: 4.2, is_alcohol_free: false, aliases: ['guiness'] } } });
check('Other spellings that belong to another beer are refused', r.status === 409 && r.body.error === 'alias_taken', JSON.stringify(r.body));
r = await admin(`/suggestion/${fresh.id}`, { cookie, body: { action: 'approve', beer: { name: 'Walthamstow Wonder', brewery: 'Test Brewery', category: 'pale_ipa', abv: 4.2, is_alcohol_free: false, aliases: ['Walthamstow Wonder Pale', 'wonder'] } } });
const newBeer = sql("SELECT id, name, category FROM beers WHERE id = 'walthamstow-wonder'")[0];
check('Approving a new beer adds it to the list with its spellings', r.status === 200 && newBeer?.category === 'pale_ipa' && sql("SELECT COUNT(*) AS n FROM beer_aliases WHERE beer_id = 'walthamstow-wonder'")[0].n === 2, JSON.stringify({ body: r.body, newBeer }));
check('…and to the pub, on cask', sql(`SELECT status FROM listings WHERE pub_id = '${pubId}' AND beer_id = 'walthamstow-wonder' AND dispense = 'cask'`)[0]?.status === 'confirmed');

// Tap list editor.
r = await admin(`/pub/${pubId}/listings`, { cookie, body: { changes: [{ beer_id: gonePick.beer_id, dispense: gonePick.dispense, set: 'on' }] } });
check('Editor can restore a removed beer', r.status === 200 && r.body.listings.some((l) => l.beer_id === gonePick.beer_id && l.status === 'confirmed'), JSON.stringify(r.body).slice(0, 200));
const [doomed] = sql(`SELECT id, beer_id, dispense FROM listings WHERE pub_id = '${pubId}' AND status != 'removed' ORDER BY id LIMIT 1`);
sql(`INSERT INTO votes (listing_id, direction, device_hash, created_at) VALUES (${doomed.id}, 1, NULL, '${new Date().toISOString()}')`);
r = await admin(`/pub/${pubId}/listings`, { cookie, body: { changes: [{ beer_id: doomed.beer_id, dispense: doomed.dispense, set: 'delete' }] } });
check('Editor can delete a beer record for good', r.status === 200 && !r.body.listings.some((l) => l.id === doomed.id) && sql(`SELECT COUNT(*) AS n FROM listings WHERE id = ${doomed.id}`)[0].n === 0, JSON.stringify(r.body).slice(0, 200));
check('…along with its votes', sql(`SELECT COUNT(*) AS n FROM votes WHERE listing_id = ${doomed.id}`)[0].n === 0);
r = await admin(`/pub/${pubId}/listings`, { cookie, body: { changes: [{ beer_id: 'no-such-beer', dispense: 'keg', set: 'on' }] } });
check('Editor refuses beers that are not in the list', r.status === 400, JSON.stringify(r.body));
r = await admin(`/pub/${pubId}/listings`, { cookie, body: { changes: [{ beer_id: 'guinness', dispense: 'can', set: 'on' }] } });
check('Editor refuses anything but cask or keg', r.status === 400, JSON.stringify(r.body));
r = await admin(`/pub/${pubId}/listings`, { cookie, origin: 'https://evil.example', body: { changes: [] } });
check('Admin changes from another website are refused', r.status === 403, JSON.stringify(r.body));

r = await admin('/logout', { cookie, body: {} });
check('Signing out clears the cookie', /Max-Age=0/.test(r.headers.get('set-cookie') ?? ''));

// --- Unchecked photos expire ----------------------------------------------------------
const staleKey = 'reports/check-api-stale';
execFileSync('npx', ['wrangler', 'kv', 'key', 'put', staleKey, 'old-photo', '--binding', 'PHOTOS', '--local'], { stdio: 'ignore' });
const staleDate = new Date(Date.now() - 31 * 86_400_000).toISOString();
sql(`INSERT INTO photo_reports (pub_id, status, device_hash, created_at) VALUES ('${pubId}', 'pending', 'feedfacefeedfacefeedfacefeedface', '${staleDate}')`);
sql(`INSERT INTO photo_report_images (report_id, position, photo_key) SELECT id, 1, '${staleKey}' FROM photo_reports WHERE created_at = '${staleDate}'`);
await fetch(`${API}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('17 3 * * *')}`);
await sleep(800);
const stale = sql(`SELECT r.status, i.photo_key, r.device_hash FROM photo_reports r JOIN photo_report_images i ON i.report_id = r.id WHERE r.created_at = '${staleDate}'`)[0];
const kvLeft = execFileSync('npx', ['wrangler', 'kv', 'key', 'list', '--binding', 'PHOTOS', '--local'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
check('Photos unchecked after 30 days are deleted and the report closed', stale?.status === 'rejected' && stale.photo_key === null && !kvLeft.includes(staleKey), JSON.stringify({ stale, kvLeft }));
check('…and the report forgets its device', stale?.device_hash === null);

// --- Privacy -------------------------------------------------------------------------
const hashes = sql('SELECT DISTINCT device_hash FROM votes WHERE device_hash IS NOT NULL').map((v) => v.device_hash);
check('Votes store a hash, never an IP address', hashes.length > 0 && hashes.every((h) => /^[0-9a-f]{32}$/.test(h)), hashes.join(','));
const dump = ['votes', 'rate_limits', 'photo_reports', 'suggestions'].map((t) => JSON.stringify(sql(`SELECT * FROM ${t}`))).join('');
check('No IP address appears in votes, reports, suggestions or counters', !dump.includes('203.0.113.'), '');

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
