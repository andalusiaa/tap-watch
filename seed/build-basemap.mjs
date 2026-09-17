// Builds the map background for an area from OpenStreetMap data (via Protomaps).
//
// Usage: npm run map:build [-- <area-id>]      (default area: e17)
//
// 1. Cuts the area out of the latest Protomaps daily build with the pmtiles tool
//    (seed/raw/tools/pmtiles), into seed/raw/<area>.pmtiles.
// 2. Writes each map tile, uncompressed, to public/map/tiles/<area>-<build date>/{z}/{x}/{y}.pbf.
//    Cloudflare can't serve parts of one big file, so the site uses these small files
//    instead; Cloudflare compresses them on the way out (see public/_headers).
// 3. Writes public/map/<area>.json, which tells the site where the tiles are.
// 4. Deletes tiles from older builds.
//
// Getting the pmtiles tool (macOS, Apple silicon), once:
//   gh release download --repo protomaps/go-pmtiles --pattern '*Darwin_arm64.zip' --dir seed/raw/tools
//   unzip seed/raw/tools/go-pmtiles-*_Darwin_arm64.zip pmtiles -d seed/raw/tools

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const seedDir = new URL('.', import.meta.url);
const publicDir = new URL('../public/map/', seedDir);
const tilesDir = new URL('tiles/', publicDir);
const tool = fileURLToPath(new URL('raw/tools/pmtiles', seedDir));
const areaId = process.argv[2] ?? 'e17';

const area = JSON.parse(await readFile(new URL('areas.json', seedDir), 'utf8')).find((a) => a.id === areaId);
if (!area?.map) throw new Error(`No map settings for area "${areaId}" in seed/areas.json`);
if (!existsSync(tool)) throw new Error(`The pmtiles tool is missing. See the instructions at the top of ${import.meta.url}`);

const { bbox, minzoom, maxzoom } = area.map;
const [west, south, east, north] = bbox;

// --- 1. Find the newest daily build and cut out the area ----------------------------

let build = null;
for (let daysAgo = 0; daysAgo < 10 && !build; daysAgo++) {
  const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
  const res = await fetch(`https://build.protomaps.com/${day}.pmtiles`, { method: 'HEAD' });
  if (res.ok) build = day;
}
if (!build) throw new Error('No Protomaps build found in the last 10 days');

const archive = fileURLToPath(new URL(`raw/${area.id}.pmtiles`, seedDir));
console.log(`Cutting ${area.name} out of Protomaps build ${build}…`);
execFileSync(
  tool,
  [
    'extract',
    `https://build.protomaps.com/${build}.pmtiles`,
    archive,
    `--bbox=${bbox.join(',')}`,
    `--minzoom=${minzoom}`,
    `--maxzoom=${maxzoom}`,
    '--quiet',
  ],
  { stdio: 'inherit' },
);

// --- 2. Write each tile as its own file ---------------------------------------------

const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const folder = `${area.id}-${build}`;
const outDir = new URL(`${folder}/`, tilesDir);
await rm(outDir, { recursive: true, force: true });

let count = 0;
let bytes = 0;
for (let z = minzoom; z <= maxzoom; z++) {
  for (let x = tileX(west, z); x <= tileX(east, z); x++) {
    for (let y = tileY(north, z); y <= tileY(south, z); y++) {
      let tile = execFileSync(tool, ['tile', archive, String(z), String(x), String(y)], { maxBuffer: 16 * 1024 * 1024 });
      if (tile.length === 0) continue;
      if (tile[0] === 0x1f && tile[1] === 0x8b) tile = gunzipSync(tile);
      const dir = new URL(`${z}/${x}/`, outDir);
      await mkdir(dir, { recursive: true });
      await writeFile(new URL(`${y}.pbf`, dir), tile);
      count++;
      bytes += tile.length;
    }
  }
}

// --- 3. Tell the site where the tiles are ---------------------------------------------

await writeFile(
  new URL(`${area.id}.json`, publicDir),
  JSON.stringify(
    {
      tiles: [`/map/tiles/${folder}/{z}/{x}/{y}.pbf`],
      bounds: bbox,
      minzoom,
      maxzoom,
      build,
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
    null,
    2,
  ) + '\n',
);

// --- 4. Remove older builds -----------------------------------------------------------

for (const entry of await readdir(tilesDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith(`${area.id}-`) && entry.name !== folder) {
    await rm(new URL(`${entry.name}/`, tilesDir), { recursive: true });
    console.log(`Removed old tiles: public/map/tiles/${entry.name}`);
  }
}

console.log(`Wrote ${count} tiles (${(bytes / 1_048_576).toFixed(1)} MB) to public/map/tiles/${folder}/`);
