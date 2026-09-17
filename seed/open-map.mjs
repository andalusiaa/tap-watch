// Opens a map of the pubs in seed/pubs-<area>.review.csv in your web browser.
//
// Usage: npm run seed:map [-- <area-id>]      (default area: e17)
//
// Green pins are pubs with include=yes; grey pins are the rest in the same postcode district.
// The map is drawn by geojson.io. The pub data travels in the link itself (after the #),
// so nothing is uploaded.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseCsv } from './lib/csv.mjs';

const seedDir = new URL('.', import.meta.url);
const areaId = process.argv[2] ?? 'e17';
const areas = JSON.parse(await readFile(new URL('areas.json', seedDir), 'utf8'));
const area = areas.find((a) => a.id === areaId);
if (!area) throw new Error(`No area "${areaId}" in seed/areas.json`);

const rows = parseCsv(await readFile(new URL(`pubs-${area.id}.review.csv`, seedDir), 'utf8'));
const shown = rows.filter((r) => r.include === 'yes' || r.district === area.postcode_district);

const geojson = {
  type: 'FeatureCollection',
  features: shown.map((r) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] },
    properties: {
      name: r.name || '(no name)',
      listed: r.include === 'yes' ? 'yes' : 'no',
      notes: r.notes,
      'marker-color': r.include === 'yes' ? '#1f7a4d' : '#8c8c8c',
    },
  })),
};

// geojson.io decodes the link once before reading it, so "#" needs encoding twice.
const data = encodeURIComponent(JSON.stringify(geojson)).replaceAll('%23', '%2523');
const url = `https://geojson.io/#data=data:application/json,${data}`;

const opener = { darwin: 'open', win32: 'explorer' }[process.platform] ?? 'xdg-open';
spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
console.log(`Opening a map of ${shown.length} places (${shown.filter((r) => r.include === 'yes').length} listed) in your browser.`);
