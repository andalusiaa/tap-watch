// Fetches candidate pubs for an area from OpenStreetMap and writes a review file.
//
// Usage: npm run seed:pubs [-- <area-id>]      (default area: e17)
//
// 1. Asks the Overpass API for every amenity=pub (and, for reference, amenity=bar)
//    inside the area's search box. Bars are listed with include=no because v1 is pubs only,
//    but some real pubs are tagged as bars in OpenStreetMap.
// 2. Asks postcodes.io for the nearest postcode to each pub, to find its postcode district.
// 3. Writes seed/pubs-<area>.review.csv for Tristan to check (set include to yes/no and
//    fill in operator_id from seed/operators.json, or "free-house"),
//    and seed/out/pubs-<area>.geojson to view the pubs on a map.
//
// The review CSV is never overwritten: if it already exists, a .new.csv is written instead.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toCsv } from './lib/csv.mjs';

const USER_AGENT = 'TapWatch-seed/0.1 (+https://github.com/andalusiaa/tap-watch)';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const POSTCODES_URL = 'https://api.postcodes.io/postcodes';

const seedDir = new URL('.', import.meta.url);
const areaId = process.argv[2] ?? 'e17';

const areas = JSON.parse(await readFile(new URL('areas.json', seedDir), 'utf8'));
const area = areas.find((a) => a.id === areaId);
if (!area) throw new Error(`No area "${areaId}" in seed/areas.json`);

const operators = JSON.parse(await readFile(new URL('operators.json', seedDir), 'utf8'));
const operatorByOsmName = new Map(operators.flatMap((o) => o.osm_names.map((n) => [n, o.id])));

const [west, south, east, north] = area.search_bbox;

// --- 1. OpenStreetMap ------------------------------------------------------

const query = `
[out:json][timeout:60];
nwr["amenity"~"^(pub|bar)$"](${south},${west},${north},${east});
out center tags;
`;

console.log(`Asking OpenStreetMap for pubs and bars around ${area.name}…`);
const osmResponse = await fetch(OVERPASS_URL, {
  method: 'POST',
  headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ data: query }),
});
if (!osmResponse.ok) throw new Error(`Overpass API error ${osmResponse.status}: ${await osmResponse.text()}`);
const osm = await osmResponse.json();

await mkdir(new URL('raw/', seedDir), { recursive: true });
await writeFile(new URL(`raw/overpass-${area.id}.json`, seedDir), JSON.stringify(osm, null, 2));

const candidates = osm.elements.map((el) => {
  const tags = el.tags ?? {};
  return {
    osm_id: `${el.type}/${el.id}`,
    lat: el.lat ?? el.center?.lat,
    lng: el.lon ?? el.center?.lon,
    tags,
  };
});
console.log(`Found ${candidates.length} pubs and bars in the search box.`);

// --- 2. Postcode districts ---------------------------------------------------

console.log('Looking up postcode districts on postcodes.io…');
for (let i = 0; i < candidates.length; i += 100) {
  const batch = candidates.slice(i, i + 100);
  const res = await fetch(POSTCODES_URL, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      geolocations: batch.map((c) => ({ longitude: c.lng, latitude: c.lat, radius: 500, limit: 1 })),
    }),
  });
  if (!res.ok) throw new Error(`postcodes.io error ${res.status}: ${await res.text()}`);
  const { result } = await res.json();
  result.forEach((r, j) => {
    const nearest = r.result?.[0];
    batch[j].nearest_postcode = nearest?.postcode ?? '';
    batch[j].district = nearest?.outcode ?? '';
  });
}

// --- 3. Review rows ----------------------------------------------------------

const TAPROOM_HINT = /tap\s?room|brewery|brewing|brew co/i;
const BREWERY_WEBSITE_HINT = /brewery|brewing|brewco/i;

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

const usedIds = new Set();
const rows = candidates.map((c) => {
  const t = c.tags;
  const name = t.name ?? '';
  const osmPostcode = (t['addr:postcode'] ?? '').toUpperCase();
  const osmDistrict = osmPostcode.split(' ')[0];
  const notes = [];

  if (!name) notes.push('No name in OpenStreetMap');
  const isBar = t.amenity === 'bar';
  if (isBar) notes.push('Tagged as a bar in OpenStreetMap (bars come later; say yes if it is really a pub)');
  if (TAPROOM_HINT.test(name) || t.craft === 'brewery' || t.microbrewery === 'yes') {
    notes.push('May be a brewery taproom (excluded from v1)');
  } else if (BREWERY_WEBSITE_HINT.test(t.website ?? '')) {
    notes.push("Website is a brewery's: check it isn't a taproom pouring only its own beer");
  }
  if (osmDistrict && c.district && osmDistrict !== c.district) {
    notes.push(`OSM address says ${osmDistrict} but nearest postcode is ${c.district}`);
  }
  if (!osmPostcode) notes.push('Postcode is the nearest one found, not from the pub address');

  const inArea = (osmDistrict || c.district) === area.postcode_district;
  const include = inArea && !isBar && name !== '' && !notes.some((n) => n.startsWith('May be a brewery'));

  let id = `${slugify(name || c.osm_id)}-${area.id}`;
  for (let n = 2; usedIds.has(id); n++) id = `${slugify(name || c.osm_id)}-${n}-${area.id}`;
  usedIds.add(id);

  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return {
    include: include ? 'yes' : 'no',
    id,
    name,
    osm_type: isBar ? 'bar' : 'pub',
    district: osmDistrict || c.district,
    postcode: osmPostcode || c.nearest_postcode,
    address: street,
    operator_id: operatorByOsmName.get((t.operator ?? '').toLowerCase()) ?? '',
    osm_operator: t.operator ?? '',
    osm_brewery: t.brewery ?? '',
    lat: c.lat.toFixed(6),
    lng: c.lng.toFixed(6),
    osm_id: c.osm_id,
    notes: notes.join('; '),
  };
});

rows.sort(
  (a, b) =>
    b.include.localeCompare(a.include) ||
    Number(b.district === area.postcode_district) - Number(a.district === area.postcode_district) ||
    a.district.localeCompare(b.district) ||
    b.osm_type.localeCompare(a.osm_type) ||
    a.name.localeCompare(b.name),
);

const columns = ['include', 'id', 'name', 'osm_type', 'district', 'postcode', 'address', 'operator_id', 'osm_operator', 'osm_brewery', 'lat', 'lng', 'osm_id', 'notes'];
const reviewPath = new URL(`pubs-${area.id}.review.csv`, seedDir);
const outPath = existsSync(reviewPath) ? new URL(`pubs-${area.id}.review.new.csv`, seedDir) : reviewPath;
await writeFile(outPath, toCsv(columns, rows));

// GeoJSON for checking the boundary on a map (e.g. geojson.io). Green = included.
const geojson = {
  type: 'FeatureCollection',
  features: rows.map((r) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] },
    properties: {
      name: r.name || '(no name)',
      district: r.district,
      include: r.include,
      notes: r.notes,
      'marker-color': r.include === 'yes' ? '#1f7a4d' : '#8c8c8c',
      'marker-size': 'small',
    },
  })),
};
await mkdir(new URL('out/', seedDir), { recursive: true });
await writeFile(new URL(`out/pubs-${area.id}.geojson`, seedDir), JSON.stringify(geojson));

// --- Summary -----------------------------------------------------------------

const included = rows.filter((r) => r.include === 'yes');
const byDistrict = Object.groupBy(rows, (r) => r.district || '?');
const lats = included.map((r) => Number(r.lat));
const lngs = included.map((r) => Number(r.lng));

console.log(`\nWrote ${outPath.pathname.split('/').slice(-2).join('/')}`);
console.log(`Suggested to include: ${included.length} of ${rows.length}`);
console.log('Pubs by district:', Object.fromEntries(Object.entries(byDistrict).map(([k, v]) => [k, v.length])));
console.log('Flagged for a look:', rows.filter((r) => r.notes && r.include === 'yes').length);
if (included.length) {
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)].map((n) => Number(n.toFixed(4)));
  console.log('Extent of included pubs [minLng, minLat, maxLng, maxLat]:', JSON.stringify(bbox));
}
