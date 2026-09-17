// Builds public/data/snapshot-<area>.json for the Phase 1 prototype.
//
// Usage: npm run seed:sample [-- <area-id>]      (default area: e17)
//
// Pubs come from seed/pubs-<area>.review.csv (rows with include=yes) and beers from
// seed/beers.json. The tap lists are INVENTED sample data so every freshness state can be
// seen. The snapshot is marked "sample": true and the site shows a banner saying so.
// Phase 2 replaces this file with live data from the database.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseCsv } from './lib/csv.mjs';
import { validateBeers } from './lib/beers.mjs';

const seedDir = new URL('.', import.meta.url);
const areaId = process.argv[2] ?? 'e17';
const readJson = async (name) => JSON.parse(await readFile(new URL(name, seedDir), 'utf8'));

const area = (await readJson('areas.json')).find((a) => a.id === areaId);
if (!area) throw new Error(`No area "${areaId}" in seed/areas.json`);

const operators = await readJson('operators.json');
const beers = await readJson('beers.json');
validateBeers(beers);

const pubRows = parseCsv(await readFile(new URL(`pubs-${area.id}.review.csv`, seedDir), 'utf8'));
const pubs = pubRows
  .filter((r) => r.include.toLowerCase() === 'yes')
  .map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    postcode: r.postcode,
    lat: Number(r.lat),
    lng: Number(r.lng),
    operator_id: r.operator_id || null,
    venue_type: 'pub',
  }));

const operatorIds = new Set(operators.map((o) => o.id));
for (const p of pubs) {
  if (p.operator_id && !operatorIds.has(p.operator_id)) {
    throw new Error(`${p.id}: operator_id "${p.operator_id}" is not in seed/operators.json`);
  }
}

// --- Sample tap lists (deterministic, so re-running gives the same result) -----

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(17);
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

/** Picks n different ids, weighted. @param {Record<string, number>} weights */
function pickWeighted(weights, n) {
  const pool = Object.entries(weights);
  const chosen = [];
  while (chosen.length < n && pool.length) {
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    let r = random() * total;
    const index = pool.findIndex(([, w]) => (r -= w) < 0);
    chosen.push(pool.splice(index === -1 ? pool.length - 1 : index, 1)[0][0]);
  }
  return chosen;
}

const pools = {
  lager: { 'birra-moretti': 6, 'stella-artois': 5, 'peroni-nastro-azzurro': 5, 'madri-excepcional': 5, 'camden-hells': 5, 'estrella-damm': 3, 'san-miguel': 3, heineken: 3, pravha: 3, 'asahi-super-dry': 3, carling: 2, coors: 2, cruzcampo: 2, fosters: 1, 'carlsberg-danish-pilsner': 1, 'kronenbourg-1664': 1, 'pilsner-urquell': 1, 'meantime-london-lager': 1, 'hop-house-13': 1, 'pillars-untraditional-lager': 1 },
  pale: { 'beavertown-neck-oil': 6, 'beavertown-gamma-ray': 2, 'camden-pale-ale': 2, 'brewdog-punk-ipa': 2, 'goose-island-ipa': 1 },
  cask: { 'fullers-london-pride': 4, 'timothy-taylor-landlord': 3, 'harveys-sussex-best-bitter': 3, 'sharps-doom-bar': 3, 'greene-king-ipa': 2, 'st-austell-tribute': 2, 'adnams-ghost-ship': 2, 'dark-star-hophead': 2, 'greene-king-abbot-ale': 1, 'oakham-citra': 1, 'youngs-original': 1, 'fullers-esb': 1 },
  cider: { 'thatchers-gold': 5, 'aspall-draught-suffolk-cyder': 3, 'strongbow-dark-fruit': 2, 'thatchers-haze': 2, 'old-mout-berries-and-cherries': 1, 'westons-stowford-press': 1, 'magners-original': 1 },
  alcoholFree: { 'guinness-0-0': 5, 'lucky-saint': 4, 'heineken-0-0': 4, 'peroni-nastro-azzurro-0-0': 2, 'birra-moretti-zero': 1 },
  stout: { guinness: 9, 'murphys-irish-stout': 1 },
};

const beerById = new Map(beers.map((b) => [b.id, b]));
for (const ids of Object.values(pools)) {
  for (const id of Object.keys(ids)) if (!beerById.has(id)) throw new Error(`Sample pool uses unknown beer ${id}`);
}

const now = Date.now();
const DAY = 86_400_000;
const daysAgo = (d) => new Date(now - d * DAY - between(0, 10) * 3_600_000).toISOString();

function sampleStatus() {
  const r = random();
  if (r < 0.15) return { status: 'likely', last_confirmed_at: null, reported_gone_at: null };
  if (r < 0.2) return { status: 'reported_gone', last_confirmed_at: daysAgo(between(20, 90)), reported_gone_at: daysAgo(between(0, 6)) };
  const age = r < 0.6 ? between(0, 14) : r < 0.85 ? between(15, 60) : between(61, 150);
  return { status: 'confirmed', last_confirmed_at: daysAgo(age), reported_gone_at: null };
}

const listings = [];
for (const pub of pubs) {
  const beerIds = [
    ...(random() < 0.9 ? pickWeighted(pools.stout, 1) : []),
    ...pickWeighted(pools.lager, between(2, 5)),
    ...pickWeighted(pools.pale, between(0, 2)),
    ...(random() < 0.6 ? pickWeighted(pools.cask, between(1, 3)) : []),
    ...pickWeighted(pools.cider, between(1, 2)),
    ...pickWeighted(pools.alcoholFree, [0, 1, 1, 2][between(0, 3)]),
    ...(random() < 0.05 ? ['dusty-ginger-beer'] : []),
  ];
  for (const beerId of beerIds) {
    listings.push({
      id: listings.length + 1,
      pub_id: pub.id,
      beer_id: beerId,
      dispense: beerById.get(beerId).category === 'bitter_cask' ? 'cask' : 'keg',
      ...sampleStatus(),
    });
  }
}

// --- Write --------------------------------------------------------------------

const snapshot = {
  version: 1,
  generated_at: new Date(now).toISOString(),
  sample: true,
  area: {
    id: area.id,
    name: area.name,
    postcode_district: area.postcode_district,
    borough: area.borough,
    centre: [area.centre_lat, area.centre_lng],
    bbox: area.bbox,
  },
  operators: operators.map(({ id, name, type }) => ({ id, name, type })),
  pubs,
  beers: beers.map(({ id, name, brewery, category, abv, is_alcohol_free, aliases }) => ({
    id,
    name,
    brewery,
    category,
    abv,
    af: is_alcohol_free,
    aliases,
  })),
  listings,
};

const outDir = new URL('../public/data/', seedDir);
await mkdir(outDir, { recursive: true });
const json = JSON.stringify(snapshot);
await writeFile(new URL(`snapshot-${area.id}.json`, outDir), json);

const statusCounts = Object.fromEntries(Object.entries(Object.groupBy(listings, (l) => l.status)).map(([k, v]) => [k, v.length]));
console.log(`Wrote public/data/snapshot-${area.id}.json (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`${pubs.length} pubs, ${beers.length} beers, ${listings.length} sample listings`, statusCounts);
