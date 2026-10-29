// One-off: adds the "Counting how the site is used" section to the live Privacy page.
// The words on that page live in the database (admin Pages tab), so editing the .html
// fallback is not enough. Run once, after the deploy that starts the counting.

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const SITE = 'https://tap-watch.gage-tristan.workers.dev';
const OLD = 'There are no advertising or tracking cookies, and no analytics.';

const live = await (await fetch(`${SITE}/api/pages/privacy`)).json();
if (!live.body.includes(OLD)) {
  console.log(live.body.includes('Counting how the site is used')
    ? 'Already done: the live page explains the counting.'
    : `Stopped: the live page no longer says "${OLD}". Edit it on the admin Pages tab instead.`);
  process.exit(live.body.includes('Counting how the site is used') ? 0 : 1);
}

// Take the new wording from the seed file, so there is one copy of it.
const seed = await readFile(new URL('seed/pages/privacy.md', import.meta.url), 'utf8');
const start = seed.indexOf('There are no advertising or tracking cookies');
const end = seed.indexOf('## Other services');
const replacement = seed.slice(start, end).trimEnd();

const body = live.body.replace(OLD, replacement);
const sql = `UPDATE pages SET body = '${body.replace(/'/g, "''")}', updated_at = '${new Date().toISOString()}' WHERE slug = 'privacy';`;
await writeFile(new URL('seed/out/privacy-update.sql', import.meta.url), sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'tap-watch', '--remote', '--file', 'seed/out/privacy-update.sql'], { stdio: 'inherit' });

const after = await (await fetch(`${SITE}/api/pages/privacy`)).json();
console.log(after.body.includes('Counting how the site is used') ? 'Live Privacy page updated.' : 'Update did not take; check the admin Pages tab.');
