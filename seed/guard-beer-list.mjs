// Stops a stale spreadsheet from hiding beers that only exist live.
//
// A beer added on the admin page lives in the live database and nowhere else. Loading a beer
// list that predates it would quietly set is_active = 0 and take it off the site, along with
// any pub that lists it. This runs before `npm run db:beers:remote` and refuses to go on.
//
//   node seed/guard-beer-list.mjs            checks seed/beers.json against the live database
//   node seed/guard-beer-list.mjs --force    loads anyway (only when the beers really should go)

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const force = process.argv.includes('--force');
const beers = JSON.parse(await readFile(new URL('beers.json', import.meta.url), 'utf8'));
const known = new Set(beers.map((b) => b.id));

let live;
try {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'tap-watch', '--remote', '--json', '--command',
      'SELECT id, name FROM beers WHERE is_active = 1'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  live = JSON.parse(out)[0].results;
} catch (error) {
  console.error(
    'Could not read the live beer list, so the load has been stopped.\n' +
      'If this says the login expired, run `npx wrangler whoami` and try again.\n' +
      String(error.stderr ?? error.message ?? error).slice(0, 400),
  );
  process.exit(1);
}

const missing = live.filter((b) => !known.has(b.id));
if (missing.length && !force) {
  console.error(
    `Stopped: ${missing.length} beer${missing.length === 1 ? '' : 's'} on the live site ` +
      `${missing.length === 1 ? 'is' : 'are'} not in seed/beers.json, and loading now would hide ` +
      `${missing.length === 1 ? 'it' : 'them'}:\n` +
      missing.map((b) => `  ${b.name} (${b.id})`).join('\n') +
      '\n\nThese were probably added on the admin page. Run `npm run beers:export` first so the ' +
      'spreadsheet includes them, then edit and import that.\n' +
      'If they really should come off the site, run the load with --force.',
  );
  process.exit(1);
}

if (missing.length) console.log(`--force: hiding ${missing.length} beer(s) that are not in the list.`);
console.log(`Checked against the live site: ${live.length} beers there, ${beers.length} in the list.`);
