// The approved beer list as a spreadsheet (CSV) you can edit in Numbers, Excel or Google Sheets.
//
//   npm run beers:export               live database → seed/out/beer-list.csv
//   npm run beers:import -- <file.csv>  checks the spreadsheet and writes seed/beers.json
//   npm run db:beers:remote             loads seed/beers.json into the live database
//
// Export from the live database (not seed/beers.json), so beers added on the admin page
// are included. A beer left out of the spreadsheet is hidden from the site (not deleted).

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalise, validateBeers } from './lib/beers.mjs';
import { parseCsv, toCsv } from './lib/csv.mjs';

const seedDir = new URL('.', import.meta.url);
const [command, fileArg] = process.argv.slice(2);

const STYLES = {
  lager: 'Lager',
  stout: 'Stout or porter',
  pale_ipa: 'Pale ale or IPA',
  bitter_cask: 'Bitter or cask ale',
  cider: 'Cider',
  other: 'Other',
};

const COLUMNS = {
  name: 'Name',
  brewery: 'Brewery',
  style: 'Style',
  abv: 'ABV %',
  af: 'Alcohol-free (yes or no)',
  aliases: 'Other spellings (separate with ;)',
  notes: 'Notes',
  id: 'ID (leave blank for new beers)',
};

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readBeersJson() {
  return JSON.parse(await readFile(new URL('beers.json', seedDir), 'utf8'));
}

async function exportCsv() {
  const useLocal = process.argv.includes('--local');
  const out = execFileSync(
    'npx',
    [
      'wrangler', 'd1', 'execute', 'tap-watch', useLocal ? '--local' : '--remote', '--json', '--command',
      `SELECT b.id, b.name, b.brewery, b.category, b.abv, b.is_alcohol_free,
              (SELECT group_concat(a.alias, '; ') FROM beer_aliases a WHERE a.beer_id = b.id) AS aliases
       FROM beers b WHERE b.is_active = 1 ORDER BY b.category, b.name`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const beers = JSON.parse(out)[0].results;
  const notes = new Map((await readBeersJson()).map((b) => [b.id, b.check]));

  const rows = beers.map((b) => ({
    [COLUMNS.name]: b.name,
    [COLUMNS.brewery]: b.brewery ?? '',
    [COLUMNS.style]: STYLES[b.category] ?? b.category,
    [COLUMNS.abv]: b.abv ?? '',
    [COLUMNS.af]: b.is_alcohol_free ? 'yes' : 'no',
    [COLUMNS.aliases]: b.aliases ?? '',
    [COLUMNS.notes]: notes.get(b.id) ?? '',
    [COLUMNS.id]: b.id,
  }));
  await mkdir(new URL('out/', seedDir), { recursive: true });
  const target = new URL('out/beer-list.csv', seedDir);
  await writeFile(target, toCsv(Object.values(COLUMNS), rows));
  console.log(`Exported ${beers.length} beers from the ${useLocal ? 'local' : 'live'} database to ${fileURLToPath(target)}`);
}

function parseStyle(value, line) {
  const wanted = value.trim().toLowerCase();
  for (const [key, label] of Object.entries(STYLES)) {
    if (wanted === key || wanted === label.toLowerCase()) return key;
  }
  throw new Error(`Line ${line}: style "${value}" should be one of: ${Object.values(STYLES).join(', ')}`);
}

async function importCsv(path) {
  if (!path) throw new Error('Give the spreadsheet file: npm run beers:import -- path/to/beer-list.csv');
  const rows = parseCsv(await readFile(path, 'utf8'));
  const problems = [];
  const beers = [];

  rows.forEach((row, i) => {
    const line = i + 2; // row 1 is the header
    const get = (column) => (row[COLUMNS[column]] ?? '').trim();
    const name = get('name').replace(/\s+/g, ' ');
    if (!name) return; // blank lines are fine
    try {
      const abvText = get('abv').replace('%', '');
      const abv = abvText === '' ? null : Number(abvText);
      if (abv !== null && Number.isNaN(abv)) throw new Error(`Line ${line}: ABV "${get('abv')}" isn't a number`);
      const afText = get('af').toLowerCase();
      beers.push({
        id: get('id') || slugify(name),
        name,
        brewery: get('brewery') || null,
        category: parseStyle(get('style'), line),
        abv,
        is_alcohol_free: ['yes', 'y', 'true', '1'].includes(afText),
        aliases: [...new Set(get('aliases').split(/[;,]/).map((a) => normalise(a)).filter((a) => a && a !== normalise(name)))],
        check: get('notes') || null,
      });
    } catch (error) {
      problems.push(error.message);
    }
  });

  const seen = new Map();
  for (const b of beers) {
    if (seen.has(b.id)) problems.push(`"${b.name}" and "${seen.get(b.id)}" end up with the same ID (${b.id})`);
    seen.set(b.id, b.name);
  }
  if (!problems.length) {
    try {
      validateBeers(beers);
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (problems.length) {
    console.error(`The spreadsheet needs a few fixes before it can be used:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  const before = new Map((await readBeersJson()).map((b) => [b.id, b]));
  const added = beers.filter((b) => !before.has(b.id)).map((b) => b.name);
  const removed = [...before.values()].filter((b) => !seen.has(b.id)).map((b) => b.name);
  const changed = beers.filter((b) => before.has(b.id) && JSON.stringify(before.get(b.id)) !== JSON.stringify(b)).map((b) => b.name);

  const json = `[\n${beers.map((b) => `  ${JSON.stringify(b)}`).join(',\n')}\n]\n`;
  await writeFile(new URL('beers.json', seedDir), json);
  console.log(`Wrote seed/beers.json: ${beers.length} beers.`);
  console.log(`  Added (${added.length}): ${added.join(', ') || 'none'}`);
  console.log(`  Changed (${changed.length}): ${changed.join(', ') || 'none'}`);
  console.log(`  Taken off the list (${removed.length}): ${removed.join(', ') || 'none'}`);
  console.log('Next: npm run db:beers:remote to update the live site.');
}

if (command === 'export') await exportCsv();
else if (command === 'import') await importCsv(fileArg);
else throw new Error('Use: node seed/beers-csv.mjs export | import <file.csv>');
