// Every word a visitor can read, as a spreadsheet to review.
//
//   npm run copy:export            writes seed/out/site-copy.csv
//
// Columns: where it appears, what it is, the words today, a blank column to write the new
// words in, and a reference so the change can be found again. Send the edited file back.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toCsv } from './lib/csv.mjs';

const seedDir = new URL('.', import.meta.url);
const root = new URL('../', seedDir);

const PAGES = [
  ['Home page', 'index.html'],
  ['Tell us page', 'feedback/index.html'],
  ['Page not found', '404.html'],
];

const CODE = [
  ['Home page', 'src/main.ts', 'Search, map key and messages'],
  ['Pub list', 'src/ui/results.ts', 'The list of pubs under the search'],
  ['Pub page', 'src/ui/pubSheet.ts', 'The panel that slides up for one pub'],
  ['Pub page', 'src/ui/labels.ts', 'Freshness badges and small labels'],
  ['Pub page', 'src/ui/forms.ts', 'Send photos and Submit a beer'],
  ['Location', 'src/ui/locationBar.ts', 'Distances, location and postcodes'],
  ['Map', 'src/ui/map.ts', 'Map controls'],
  ['Search box', 'src/ui/typedPlaceholder.ts', 'The typing example in the search box'],
  ['Tell us page', 'src/feedback.ts', 'Messages while sending'],
  ['Messages when something goes wrong', 'src/api.ts', 'Shown when the site can’t be reached'],
  ['Messages when something goes wrong', 'worker/http.ts', 'Replies from the server'],
  ['Messages when something goes wrong', 'worker/guard.ts', 'Spam and limit messages'],
  ['Messages when something goes wrong', 'worker/vote.ts', 'Voting replies'],
  ['Messages when something goes wrong', 'worker/reports.ts', 'Photo and beer submission replies'],
  ['Messages when something goes wrong', 'worker/feedback.ts', 'Feedback replies'],
];

/** Odds and ends the scan picks up that aren't wording. */
const SKIP = new Set([
  'No {many}', '{n} {many}', 'pub has', 'pubs have', 'result {extra class}', 'select, input',
  'input:checked', 'image/jpeg', 'Tap Watch E17',
]);

/** Fill-in-the-blanks shown plainly: ${beer.name} reads as {beer name}. */
const readable = (text) =>
  text
    .replace(/\$\{([^}]*)\}/g, (_, expression) => {
      const name = (expression.match(/[A-Za-z_][\w.]*/g) ?? ['…']).pop().split('.').pop();
      return `{${name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}}`;
    })
    .replace(/\s+/g, ' ')
    .trim();

/** Strings that are plumbing, not wording. */
const ignore = (text) =>
  text.length < 4 ||
  !/[a-z]/i.test(text) ||
  !/\s/.test(text) ||                      // single words are almost always code
  /^[a-z0-9-]+$/.test(text) ||             // class names, ids, slugs
  /^[A-Z_]+$/.test(text) ||
  /^(https?:|\/|#|\.)/.test(text) ||
  /^(image|application|text)\//.test(text) ||
  /[{}]|=>|\bh\(|class:|null,|\bconst\b|\breturn\b/.test(text.replace(/\{[a-z ]+\}/g, '')) ||
  /^[,.:;?]/.test(text) ||                 // a fragment caught between two quotes
  !/[a-zA-Z]{3}/.test(text) ||
  /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)+$/.test(text) && !/ (a|the|and|or|of|to|in|on|is|are|no|not|yet) /.test(` ${text} `) ||
  SKIP.has(text)

const rows = [];
const add = (section, where, what, text, reference) => {
  const trimmed = readable(text);
  if (!trimmed || ignore(trimmed)) return;
  if (rows.some((r) => r['The words now'] === trimmed && r.Where === where)) return;
  rows.push({
    Where: where,
    'What it is': what,
    'The words now': trimmed,
    'Change it to (leave blank to keep)': '',
    Reference: reference,
  });
};

// --- Pages built into the site ------------------------------------------------------
for (const [where, file] of PAGES) {
  const html = (await readFile(new URL(file, root), 'utf8')).split('\n');
  html.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const [, attr, value] of line.matchAll(/\b(placeholder|aria-label|title)="([^"]+)"/g)) {
      add(where, where, `${attr === 'placeholder' ? 'Placeholder text' : 'Spoken by screen readers'}`, value, at);
    }
    // Text between tags, one line at a time.
    for (const [, text] of line.matchAll(/>([^<>{}]+)</g)) add(where, where, 'On the page', text, at);
  });
}

// --- Wording inside the code ---------------------------------------------------------
for (const [where, file, what] of CODE) {
  const lines = (await readFile(new URL(file, root), 'utf8')).split('\n');
  let inComment = false;
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*\/\*/.test(line)) inComment = true;
    if (inComment) {
      if (/\*\//.test(line)) inComment = false;
      return;
    }
    const at = `${file}:${i + 1}`;
    for (const [, text] of code.matchAll(/'((?:[^'\\]|\\.){3,})'/g)) add(where, where, what, text.replace(/\\'/g, "'"), at);
    for (const [, text] of code.matchAll(/"((?:[^"\\]|\\.){3,})"/g)) add(where, where, what, text, at);
    for (const [, text] of code.matchAll(/`([^`]{3,})`/g)) add(where, where, what, text, at);
  });
}

// --- The pages Tristan can already edit himself ---------------------------------------
const SITE = process.env.TAP_WATCH_SITE ?? 'https://tap-watch.gage-tristan.workers.dev';
for (const [slug, where] of [
  ['about', 'About page'],
  ['how-it-works', 'How it works page'],
  ['faq', 'Questions page'],
  ['privacy', 'Privacy page'],
]) {
  try {
    const page = await fetch(`${SITE}/api/pages/${slug}`).then((r) => r.json());
    add(where, where, 'Page title — edit on the admin Pages tab', page.title, `Pages tab → ${slug}`);
    for (const block of page.body.split('\n').map((b) => b.trim()).filter(Boolean)) {
      add(where, where, 'Edit on the admin Pages tab', block.replace(/^[#-]+\s*/, ''), `Pages tab → ${slug}`);
    }
  } catch {
    console.warn(`Couldn't fetch the ${slug} page from ${SITE}; its words are missing from the file.`);
  }
}

await mkdir(new URL('out/', seedDir), { recursive: true });
const target = new URL('out/site-copy.csv', seedDir);
await writeFile(target, toCsv(['Where', 'What it is', 'The words now', 'Change it to (leave blank to keep)', 'Reference'], rows));
console.log(`Wrote ${rows.length} pieces of wording to ${target.pathname}`);
