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

// The local server drops keep-alive connections that have gone quiet, and one slow database
// call between two posts is long enough for that, so a dropped connection is retried once.
async function ask(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    return fetch(url, init);
  }
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
  const res = await ask(`${API}/api/snapshot?area=e17`);
  return res.headers.get('X-Form-Token');
}

// A browser's own random number, the thing the server now tells devices apart by.
const newDeviceId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');

// Each "device" gets its own address too, so the per-address flood limit doesn't
// interfere with the per-device rules being checked. `id` can be fixed to share one
// browser number between two addresses, or set to '' to send none at all.
let deviceCount = 0;
function device(name, { ip = `203.0.113.${++deviceCount}`, id = newDeviceId() } = {}) {
  return (body, token) =>
    ask(`${API}/api/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: API,
        'User-Agent': `check-api ${name}`,
        'CF-Connecting-IP': ip,
        ...(id ? { 'X-Tap-Device': id } : {}),
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

// --- Telling devices apart -----------------------------------------------------------
// A phone's address changes when it moves between Wi-Fi and mobile data, and a whole pub
// shares one address, so the browser's own random number is what counts now.
const votePub = sql("SELECT id FROM pubs WHERE is_active = 1 ORDER BY id LIMIT 1")[0].id;
const spareBeers = sql(`SELECT id FROM beers WHERE is_active = 1 AND id NOT IN (SELECT beer_id FROM listings WHERE pub_id = '${votePub}') ORDER BY id LIMIT 3`).map((b) => b.id);
const nowIso = new Date().toISOString();
sql(spareBeers.map((beerId) => `INSERT INTO listings (pub_id, beer_id, dispense, status, source, last_confirmed_at, updated_at)
       VALUES ('${votePub}', '${beerId}', 'keg', 'confirmed', 'admin', '${nowIso}', '${nowIso}')`).join(';'));
const spareListings = spareBeers.map(
  (beerId) => sql(`SELECT id FROM listings WHERE pub_id = '${votePub}' AND beer_id = '${beerId}' AND dispense = 'keg'`)[0].id,
);

const roamingId = newDeviceId();
const onWifi = device('roamer wifi', { id: roamingId });
const onMobile = device('roamer mobile', { id: roamingId });
r = await onWifi({ listing_id: spareListings[0], direction: 1 }, token);
check('A vote from a browser with its own number is accepted', r.status === 200 && r.body.listing, JSON.stringify(r));
r = await onMobile({ listing_id: spareListings[0], direction: 1 }, token);
check('The same browser on another network is still the same device', r.status === 429 && r.body.error === 'already_voted', JSON.stringify(r));

const sharedWifi = { ip: '203.0.113.90' };
const firstDrinker = device('shared', sharedWifi);
const secondDrinker = device('shared', sharedWifi);
r = await firstDrinker({ listing_id: spareListings[1], direction: 1 }, token);
check('One person on a pub\'s Wi-Fi can vote', r.status === 200 && r.body.listing, JSON.stringify(r));
r = await secondDrinker({ listing_id: spareListings[1], direction: 1 }, token);
check('The next person on the same Wi-Fi counts as somebody else', r.status === 200 && r.body.listing, JSON.stringify(r));

const noStorage = { ip: '203.0.113.91', id: '' };
r = await device('private', noStorage)({ listing_id: spareListings[2], direction: 1 }, token);
check('A browser that can\'t store a number can still vote', r.status === 200 && r.body.listing, JSON.stringify(r));
r = await device('private', noStorage)({ listing_id: spareListings[2], direction: 1 }, token);
check('Without a number the address and browser are used instead', r.status === 429 && r.body.error === 'already_voted', JSON.stringify(r));
r = await device('private', { ...noStorage, id: 'pretend-number' })({ listing_id: spareListings[2], direction: 1 }, token);
check('A made-up number is ignored, not trusted', r.status === 429 && r.body.error === 'already_voted', JSON.stringify(r));

// --- Housekeeping ------------------------------------------------------------------
const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
sql(`INSERT INTO votes (listing_id, direction, device_hash, created_at) VALUES (${likely}, 1, 'feedfacefeedfacefeedfacefeedface', '${old}')`);
sql(`INSERT INTO rate_limits (key, count, expires_at) VALUES ('check-api:expired', 1, '${old}')`);
const cron = await ask(`${API}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('17 3 * * *')}`);
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
  const id = newDeviceId();
  return (fields, file = { bytes: fakeJpeg, type: 'image/jpeg' }, copies = 1, takenAt) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ hp: '', token, ...fields })) form.set(k, v);
    for (let i = 0; i < copies && file; i++) {
      form.append('photo', new Blob([file.bytes], { type: file.type }), `taps-${i + 1}.jpg`);
      form.append('taken_at', takenAt ?? '');
    }
    return ask(`${API}/api/report`, {
      method: 'POST',
      headers: { Origin: API, 'User-Agent': `check-api ${name}`, 'CF-Connecting-IP': ip, 'X-Tap-Device': id },
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
const suggesterId = newDeviceId();
const suggest = (body) =>
  ask(`${API}/api/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: API,
      'User-Agent': 'check-api suggester',
      'CF-Connecting-IP': '203.0.113.200',
      'X-Tap-Device': suggesterId,
    },
    body: JSON.stringify({ hp: '', token, ...body }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
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
  ask(`${API}/api/admin${path}`, {
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
// --- When the photo was taken ---
const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
const dater = reporter('dater');
await dater({ pub_id: pubId, note: 'Old photo' }, undefined, 1, twoWeeksAgo);
await dater({ pub_id: pubId, note: 'Silly date' }, undefined, 1, new Date(Date.now() + 40 * 86_400_000).toISOString());
await dater({ pub_id: pubId, note: 'Nonsense date' }, undefined, 1, 'not a date');
r = await admin('/queue', { cookie });
const dated = r.body.reports.find((x) => x.note === 'Old photo');
const future = r.body.reports.find((x) => x.note === 'Silly date');
const nonsense = r.body.reports.find((x) => x.note === 'Nonsense date');
check('The date a photo was taken is kept', dated?.taken_at?.slice(0, 10) === twoWeeksAgo.slice(0, 10), JSON.stringify(dated));
check('A date in the future is ignored', future?.taken_at === null, JSON.stringify(future));
check('An unreadable date is ignored', nonsense?.taken_at === null, JSON.stringify(nonsense));

r = await admin(`/report/${dated.id}`, { cookie, body: { action: 'approve', changes: [{ beer_id: 'guinness', dispense: 'keg', set: 'on' }] } });
check('Approving dates the tick from when the photo was taken', r.status === 200 &&
  sql(`SELECT last_confirmed_at FROM listings WHERE pub_id = '${pubId}' AND beer_id = 'guinness' AND dispense = 'keg'`)[0]?.last_confirmed_at.slice(0, 10) === twoWeeksAgo.slice(0, 10),
  JSON.stringify(r.body));

await dater({ pub_id: pubId, note: 'Old photo, dated today' }, undefined, 1, twoWeeksAgo);
r = await admin('/queue', { cookie });
const overridden = r.body.reports.find((x) => x.note === 'Old photo, dated today');
r = await admin(`/report/${overridden.id}`, { cookie, body: { action: 'approve', dated: 'sent', changes: [{ beer_id: 'carling', dispense: 'keg', set: 'on' }] } });
check('"When sent" overrides the photo date', r.status === 200 &&
  sql(`SELECT last_confirmed_at FROM listings WHERE pub_id = '${pubId}' AND beer_id = 'carling' AND dispense = 'keg'`)[0]?.last_confirmed_at.slice(0, 10) === new Date().toISOString().slice(0, 10));


// Suggestions: approve the listed beer, add the new one as a new beer.
const [known, fresh] = sql('SELECT id, beer_id FROM suggestions ORDER BY id');
r = await admin(`/suggestion/${known.id}`, { cookie, body: { action: 'approve' } });
const suggested = () => sql(`SELECT id, status, source, last_confirmed_at FROM listings WHERE pub_id = '${pubId}' AND beer_id = 'lucky-saint' AND dispense = 'keg'`)[0];
check('Approving a suggestion adds the beer to the pub, but unconfirmed',
  r.status === 200 && suggested()?.status === 'likely' && suggested()?.source === 'suggestion' && suggested()?.last_confirmed_at === null,
  JSON.stringify({ body: r.body, row: suggested() }));

// Only somebody else can confirm it: the person who reported it can't vouch for themselves,
// even from a different address and browser (their phone's own number gives them away).
const asSuggester = device('somewhere else', { id: suggesterId });
const suggestedId = suggested().id;
r = await asSuggester({ listing_id: suggestedId, direction: 1 }, token);
check('A 👍 from whoever reported the beer leaves it unconfirmed, wherever they are',
  r.status === 200 && suggested().status === 'likely' && suggested().last_confirmed_at === null, JSON.stringify({ r, row: suggested() }));
check('Their vote is still counted, so the buttons settle', sql(`SELECT COUNT(*) AS n FROM votes WHERE listing_id = ${suggestedId}`)[0].n === 1);

// And the next person in that pub is a different device, though they share its Wi-Fi.
const neighbour = device('suggester', { ip: '203.0.113.200' });
r = await neighbour({ listing_id: suggestedId, direction: 1 }, token);
check('A 👍 from someone else on the same pub Wi-Fi confirms it and dates it',
  r.status === 200 && suggested().status === 'confirmed' && Date.now() - Date.parse(suggested().last_confirmed_at) < 60_000,
  JSON.stringify({ r, row: suggested() }));

// An unconfirmed report nobody backs up is hidden after 8 weeks, not deleted.
sql(`INSERT INTO listings (pub_id, beer_id, dispense, status, source, last_confirmed_at, updated_at)
     VALUES ('${pubId}', 'carling', 'cask', 'likely', 'suggestion', NULL, '2026-01-01T00:00:00.000Z')`);
const strandedId = sql(`SELECT id FROM listings WHERE pub_id = '${pubId}' AND beer_id = 'carling' AND dispense = 'cask'`)[0].id;
const versionBefore = sql('SELECT version FROM snapshot_cache LIMIT 1')[0].version;
await ask(`${API}/cdn-cgi/handler/scheduled`);
await sleep(600);
check('An unconfirmed beer nobody confirms is hidden after 8 weeks',
  sql(`SELECT status FROM listings WHERE id = ${strandedId}`)[0].status === 'removed', JSON.stringify(sql(`SELECT * FROM listings WHERE id = ${strandedId}`)));
check('Hiding it is logged and the beer lists are rebuilt',
  sql('SELECT version FROM snapshot_cache LIMIT 1')[0].version > versionBefore &&
    sql(`SELECT COUNT(*) AS n FROM admin_log WHERE action = 'unconfirmed_hidden'`)[0].n === 1);
check('A beer confirmed by a visitor is left alone by the clean-up',
  sql(`SELECT status FROM listings WHERE id = ${suggestedId}`)[0].status === 'confirmed');
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
await ask(`${API}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('17 3 * * *')}`);
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

// --- Activity tab (admin) ---
r = await admin('/activity?type=all&pub=');
check('Activity needs sign-in', r.status === 401);
r = await admin('/activity?type=all&pub=', { cookie });
check('Activity lists votes, photo reports, submissions and admin changes', r.status === 200 && ['vote', 'report', 'submission', 'admin'].every((k) => r.body.entries.some((e) => e.kind === k)), JSON.stringify(r.body).slice(0, 300));
check('Activity shows visitor labels, never device hashes', r.body.entries.some((e) => /^[A-Z][a-z]+ [A-Z][a-z]+ \d{1,2}$/.test(e.visitor ?? '')) && !/[0-9a-f]{32}/.test(JSON.stringify(r.body)));
check('Activity lists the busiest visitors', Array.isArray(r.body.visitors) && r.body.visitors.length > 0 && r.body.visitors.every((v) => v.visitor));
check('Admin changes are described in words', r.body.entries.some((e) => e.kind === 'admin' && /approved a photo report/.test(e.text)), JSON.stringify(r.body.entries.filter((e) => e.kind === 'admin')).slice(0, 300));
r = await admin('/activity?type=admin&pub=', { cookie });
check('Activity can show only admin changes', r.status === 200 && r.body.entries.length > 0 && r.body.entries.every((e) => e.kind === 'admin'));
// One visitor ticking several beers at one pub is a single activity entry.
const barfly = device('barfly');
const pubForVotes = sql(`SELECT pub_id FROM listings WHERE status != 'removed' GROUP BY pub_id HAVING COUNT(*) >= 3 LIMIT 1`)[0].pub_id;
const threeListings = sql(`SELECT id FROM listings WHERE pub_id = '${pubForVotes}' AND status != 'removed' LIMIT 3`);
for (const row of threeListings) await barfly({ listing_id: row.id, direction: 1 }, token);
r = await admin('/activity?type=votes&pub=', { cookie });
const grouped = r.body.entries.find((e) => (e.votes ?? 1) > 1);
check('A run of votes at one pub is grouped into one entry', grouped?.votes === 3 && grouped.text.split('\n').length === 3, JSON.stringify(grouped));
check('Grouped votes keep one visitor label', typeof grouped?.visitor === 'string' && grouped.visitor.length > 3);

r = await admin('/activity?type=nonsense&pub=', { cookie });
check('An unknown activity type is refused', r.status === 400);

// --- Editable pages ---
r = await ask(`${API}/api/pages/about`).then(async (res) => ({ status: res.status, body: await res.json() }));
check('Anyone can read a page', r.status === 200 && r.body.title.length > 3 && r.body.body.includes('##'), JSON.stringify(r.body).slice(0, 120));
r = await ask(`${API}/api/pages/not-a-page`).then(async (res) => ({ status: res.status }));
check('An unknown page is a 404', r.status === 404);
r = await admin('/pages');
check('Editing pages needs sign-in', r.status === 401);
r = await admin('/pages', { cookie });
check('The admin sees every page', r.status === 200 && r.body.pages.length === 4, JSON.stringify(r.body.pages?.map((p) => p.slug)));
r = await admin('/pages/about', { cookie, body: { title: 'About Tap Watch', body: '## Hello\n\nA new first line.' } });
check('A page can be saved', r.status === 200);
r = await ask(`${API}/api/pages/about`).then(async (res) => res.json());
check('The saved words are what visitors get', r.body.includes('A new first line.'));
r = await admin('/pages/about', { cookie, body: { title: 'About', body: '<script>alert(1)</script>' } });
check('HTML in a page is refused', r.status === 400 && r.body.error === 'no_html', JSON.stringify(r.body));
r = await admin('/pages/about', { cookie, body: { title: '', body: 'words' } });
check('A page needs a title', r.status === 400);
r = await admin('/pages/about', { cookie, body: { title: 'About', body: '' } });
check('A page needs some words', r.status === 400);
r = await admin('/pages/about', { cookie, body: { title: 'About', body: 'words' }, origin: 'https://evil.example' });
check('Page edits need the same origin', r.status === 403);
check('A page edit is logged', sql(`SELECT COUNT(*) AS n FROM admin_log WHERE action = 'page_edited'`)[0].n >= 1);

// --- Feedback box ---
const tokenRes = await ask(`${API}/api/form-token`);
const plainToken = tokenRes.headers.get('X-Form-Token');
check('The token endpoint hands out a page token', tokenRes.status === 200 && typeof plainToken === 'string' && plainToken.length > 10);
const tell = (message, extra = {}, ip = '203.0.113.180') =>
  ask(`${API}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: API, 'User-Agent': 'check-api teller', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ hp: '', token: plainToken, message, ...extra }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));

await sleep(2_100);
r = await tell('Could you add a dartboard filter?');
check('Feedback is accepted', r.status === 200 && r.body.ok, JSON.stringify(r));
r = await tell('');
check('An empty message is refused', r.status === 400);
r = await tell('x'.repeat(1_001));
check('An over-long message is refused', r.status === 400);
r = await tell('spam', { hp: 'http://spam.example' });
check('A filled spam trap is quietly ignored', r.status === 200 && sql(`SELECT COUNT(*) AS n FROM feedback WHERE message = 'spam'`)[0].n === 0);
r = await ask(`${API}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
  body: JSON.stringify({ message: 'hello', hp: '', token: plainToken }),
});
check('Feedback from another website is refused', r.status === 403);

r = await admin('/feedback');
check('Feedback needs sign-in', r.status === 401);
r = await admin('/feedback', { cookie });
const waiting = r.body.pending.find((f) => f.message.includes('dartboard'));
check('The admin sees waiting messages', Boolean(waiting) && r.body.kept.length === 0, JSON.stringify(r.body).slice(0, 200));
check('Messages never carry a device hash to the browser', !/[0-9a-f]{32}/.test(JSON.stringify(r.body)));
r = await admin(`/feedback/${waiting.id}`, { cookie, body: { action: 'keep' } });
check('A message can be kept as an idea', r.status === 200);
r = await admin('/feedback', { cookie });
check('Kept ideas stay on the page', r.body.kept.some((f) => f.message.includes('dartboard')) && r.body.pending.length === 0);

await tell('Delete me please', {}, '203.0.113.181');
r = await admin('/feedback', { cookie });
const binned = r.body.pending.find((f) => f.message === 'Delete me please');
r = await admin(`/feedback/${binned.id}`, { cookie, body: { action: 'reject' } });
check('A discarded message is deleted outright', r.status === 200 && sql(`SELECT COUNT(*) AS n FROM feedback WHERE id = ${binned.id}`)[0].n === 0);
check('A decision is written to the activity log', sql(`SELECT COUNT(*) AS n FROM admin_log WHERE action LIKE 'feedback_%'`)[0].n === 2);

// --- Pubs and the test banner (admin) ---
r = await admin('/pubs?area=e17');
check('Pub list needs sign-in', r.status === 401);
r = await admin('/pubs?area=e17', { cookie });
check('Pub list includes pubs, operators and the banner state', r.status === 200 && r.body.pubs.length > 5 && r.body.operators.length >= 2 && r.body.sample === true);
const editPub = r.body.pubs.find((p) => p.is_active);
const pubBody = (overrides = {}) => ({
  pub: { name: editPub.name, address: editPub.address, postcode: editPub.postcode, lat: editPub.lat, lng: editPub.lng, venue_type: 'pub', is_active: true, operator_id: editPub.operator_id, new_operator: null, ...overrides },
});
r = await admin(`/pubs/${editPub.id}`, { cookie, body: pubBody({ name: 'Renamed Arms', new_operator: { name: 'Test Taverns', type: 'pubco' } }) });
check('A pub can be renamed and given a new operator', r.status === 200, JSON.stringify(r.body));
r = await admin('/pubs?area=e17', { cookie });
const renamed = r.body.pubs.find((p) => p.id === editPub.id);
check('The rename and new operator are saved', renamed?.name === 'Renamed Arms' && r.body.operators.some((o) => o.name === 'Test Taverns' && o.id === renamed.operator_id));
r = await admin(`/pubs/${editPub.id}`, { cookie, body: pubBody({ lat: 52.5, lng: -1.9 }) });
check('A map position outside the area is refused', r.status === 400);
r = await admin(`/pubs/${editPub.id}`, { cookie, body: pubBody({ postcode: 'NOT A PC' }) });
check('A bad postcode is refused', r.status === 400);
r = await admin(`/pubs/${editPub.id}`, { cookie, body: pubBody({ is_active: false }) });
r = await admin('/pubs?area=e17', { cookie });
check('A pub can be marked closed', r.body.pubs.find((p) => p.id === editPub.id)?.is_active === 0);
r = await admin('/pubs?area=e17', { cookie, body: { pub: { name: 'The Test Tap', address: '1 Hoe Street', postcode: 'E17 4SA', lat: 51.583, lng: -0.02, venue_type: 'bar', is_active: true, operator_id: null, new_operator: null } } });
check('A new pub can be added', r.status === 200 && r.body.id === 'the-test-tap-e17', JSON.stringify(r.body));
r = await admin('/pubs?area=e17', { cookie, body: { pub: { name: 'The Test Tap', address: '', postcode: '', lat: 51.583, lng: -0.02, venue_type: 'pub', is_active: true, operator_id: null, new_operator: null } } });
check('A second pub with the same name gets its own ID', r.status === 200 && r.body.id === 'the-test-tap-2-e17', JSON.stringify(r.body));
r = await admin('/area/e17/sample', { cookie, body: { sample: false } });
check('The test banner can be turned off', r.status === 200);
r = await admin('/activity?type=admin&pub=', { cookie });
check('Pub and banner changes are logged', ['Renamed Arms: renamed from', 'Added The Test Tap', 'Test banner turned off'].every((t) => r.body.entries.some((e) => e.text.includes(t))), JSON.stringify(r.body.entries.map((e) => e.text)).slice(0, 400));
r = await admin('/area/e17/sample', { cookie, body: { sample: false }, origin: 'https://evil.example' });
check('Pub and banner changes need the same origin', r.status === 403);

// --- Counting how the site is used ---
const statOf = (kind, key = '') => sql(`SELECT COALESCE(SUM(n), 0) AS n FROM stats WHERE kind = '${kind}' AND key = '${key}'`)[0].n;
const countTally = (events, { origin = API, tok } = {}) =>
  ask(`${API}/api/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '203.0.113.240' },
    body: JSON.stringify({ token: tok, events }),
  });

const countToken = await freshToken();
// Earlier checks opened the About page too, so compare before and after.
const aboutBefore = statOf('page', 'about');
await ask(`${API}/api/snapshot?area=e17&page=home`);
await ask(`${API}/api/snapshot?area=e17`);
await ask(`${API}/api/pages/about`);
await sleep(1000);
check('Opening the home page is counted once, and the admin page not at all', statOf('page', 'home') === 1, `home=${statOf('page', 'home')}`);
check('Opening a words page is counted', statOf('page', 'about') === aboutBefore + 1, `${aboutBefore} → ${statOf('page', 'about')}`);

r = await countTally([{ kind: 'search', key: 'guinness' }, { kind: 'pub', key: 'the-bell-e17' }, { kind: 'map' }, { kind: 'miss', key: 'Fizzy Lager 9%' }], { tok: countToken });
check('Counts from the browser are taken, with no answer to read', r.status === 204);
await sleep(200);
check('A search, a pub list and a map open are counted', statOf('search', 'guinness') === 1 && statOf('pub', 'the-bell-e17') === 1 && statOf('map') === 1);
check('Words that found nothing are tidied before being kept', statOf('miss', 'fizzy lager 9%') === 1, JSON.stringify(sql(`SELECT key, n FROM stats WHERE kind = 'miss'`)));

await countTally([{ kind: 'search', key: 'not-a-real-beer' }, { kind: 'pub', key: 'not-a-real-pub' }], { tok: countToken });
await sleep(200);
check('Made-up beers and pubs are not counted', sql(`SELECT COUNT(*) AS n FROM stats WHERE key LIKE 'not-a-real-%'`)[0].n === 0);
await countTally([{ kind: 'page', key: 'home' }, { kind: 'vote' }], { tok: countToken });
await sleep(200);
check('A browser cannot invent page views or votes', statOf('page', 'home') === 1 && statOf('vote') === sql(`SELECT COALESCE(SUM(n), 0) AS n FROM stats WHERE kind = 'vote'`)[0].n);
r = await countTally([{ kind: 'map' }], { origin: 'https://evil.example', tok: countToken });
await sleep(200);
check('Counts from another site are ignored', r.status === 204 && statOf('map') === 1);
r = await countTally([{ kind: 'map' }], { tok: 'rubbish' });
await sleep(200);
check('Counts without a real page token are ignored', r.status === 204 && statOf('map') === 1);
check('Votes, photos, submissions and messages are counted as they happen',
  statOf('vote') > 0 && statOf('photo') > 0 && statOf('beer') > 0 && statOf('message') > 0,
  `vote=${statOf('vote')} photo=${statOf('photo')} beer=${statOf('beer')} message=${statOf('message')}`);

check('The numbers need sign-in', (await admin('/stats?days=30')).status === 401);
r = await admin('/stats?days=30', { cookie });
check('The numbers come back with totals and top lists',
  r.status === 200 && r.body.days === 30 && r.body.daily.length === 30 &&
    r.body.totals.page === sql(`SELECT SUM(n) AS n FROM stats WHERE kind = 'page'`)[0].n &&
    r.body.searches.some((x) => x.key === 'guinness' && x.name) && r.body.pubs.some((x) => x.key === 'the-bell-e17'),
  JSON.stringify(r.body).slice(0, 400));
check('A silly period falls back to 30 days', (await admin('/stats?days=4000', { cookie })).body.days === 30);
check('The numbers say nothing about any person', !JSON.stringify(r.body).includes('device'));

// --- The admin home tab ---
check('The dashboard needs sign-in', (await admin('/dashboard?area=e17')).status === 401);
check('The dashboard refuses a made-up area', (await admin('/dashboard?area=NOT AN AREA', { cookie })).status === 400);
r = await admin('/dashboard?area=e17', { cookie });
const home = r.body;
const pendingNow = (table) => sql(`SELECT COUNT(*) AS n FROM ${table} WHERE status = 'pending'`)[0].n;
check(
  'The dashboard counts what is still waiting',
  r.status === 200 &&
    home.queue.reports === pendingNow('photo_reports') &&
    home.queue.suggestions === pendingNow('suggestions') &&
    home.ideas.pending === pendingNow('feedback'),
  JSON.stringify(home.queue) + JSON.stringify(home.ideas),
);
check('The dashboard names pubs with no beers listed', home.pubs.no_beers.count >= 1 && home.pubs.no_beers.names.includes('The Test Tap'), JSON.stringify(home.pubs));
check('The dashboard follows the banner switch', home.sample === false);
check('The dashboard reports the write budget', home.usage.write_budget === 50000 && home.usage.writes > 0, JSON.stringify(home.usage));
check('The dashboard sends no personal data', !JSON.stringify(home).includes('device') && !JSON.stringify(home).includes('message'));

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
