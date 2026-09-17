// GET /api/snapshot?area=e17 — everything the page needs, in one JSON document.
//
// Building it reads a few hundred rows, so the result is cached in the snapshot_cache
// table and rebuilt at most once a minute after something changes. Most page loads read
// a single row. (Cloudflare's edge cache isn't available on *.workers.dev addresses.)

import type { Beer, Listing, Operator, Pub, Snapshot } from '../src/types';
import { SNAPSHOT } from './config';
import { isoTime } from './http';

interface AreaRow {
  id: string;
  name: string;
  postcode_district: string;
  borough: string;
  centre_lat: number;
  centre_lng: number;
  bbox: string;
  is_sample: number;
}

type BeerRow = Omit<Beer, 'af' | 'aliases'> & { is_alcohol_free: number };

const memory = new Map<string, { json: string; at: number }>();

export const isAreaId = (value: string | null): value is string => !!value && /^[a-z0-9-]{1,20}$/.test(value);

async function build(db: D1Database, areaId: string, now: number): Promise<string | null> {
  const [areas, operators, pubs, beers, aliases, listings] = await db.batch([
    db.prepare(
      'SELECT id, name, postcode_district, borough, centre_lat, centre_lng, bbox, is_sample FROM areas WHERE id = ?1',
    ).bind(areaId),
    db.prepare('SELECT id, name, type FROM operators'),
    db.prepare(
      `SELECT id, name, address, postcode, lat, lng, operator_id, venue_type
       FROM pubs WHERE area_id = ?1 AND is_active = 1`,
    ).bind(areaId),
    db.prepare('SELECT id, name, brewery, category, abv, is_alcohol_free FROM beers WHERE is_active = 1'),
    db.prepare('SELECT alias, beer_id FROM beer_aliases'),
    db.prepare(
      `SELECT l.id, l.pub_id, l.beer_id, l.dispense, l.status, l.last_confirmed_at, l.reported_gone_at
       FROM pubs p
       JOIN listings l ON l.pub_id = p.id
       JOIN beers b ON b.id = l.beer_id
       WHERE p.area_id = ?1 AND p.is_active = 1 AND b.is_active = 1 AND l.status != 'removed'`,
    ).bind(areaId),
  ]);

  const area = (areas?.results as AreaRow[] | undefined)?.[0];
  if (!area) return null;

  const aliasesByBeer = new Map<string, string[]>();
  for (const { alias, beer_id } of (aliases?.results ?? []) as { alias: string; beer_id: string }[]) {
    aliasesByBeer.set(beer_id, [...(aliasesByBeer.get(beer_id) ?? []), alias]);
  }

  const snapshot: Snapshot = {
    version: 1,
    generated_at: isoTime(now),
    sample: area.is_sample === 1,
    area: {
      id: area.id,
      name: area.name,
      postcode_district: area.postcode_district,
      borough: area.borough,
      centre: [area.centre_lat, area.centre_lng],
      bbox: JSON.parse(area.bbox) as Snapshot['area']['bbox'],
    },
    operators: (operators?.results ?? []) as Operator[],
    pubs: (pubs?.results ?? []) as Pub[],
    beers: ((beers?.results ?? []) as BeerRow[]).map(({ is_alcohol_free, ...beer }) => ({
      ...beer,
      af: is_alcohol_free === 1,
      aliases: aliasesByBeer.get(beer.id) ?? [],
    })),
    listings: (listings?.results ?? []) as Listing[],
  };
  return JSON.stringify(snapshot);
}

export async function getSnapshotJson(db: D1Database, areaId: string, now: number): Promise<string | null> {
  const remembered = memory.get(areaId);
  if (remembered && now - remembered.at < SNAPSHOT.memoryTtlMs) return remembered.json;

  const cached = await db
    .prepare('SELECT json, built_at, built_version, version FROM snapshot_cache WHERE area_id = ?')
    .bind(areaId)
    .first<{ json: string | null; built_at: string | null; built_version: number; version: number }>();

  const upToDate = cached?.json && cached.built_version >= cached.version;
  const recentEnough = cached?.json && cached.built_at && now - Date.parse(cached.built_at) < SNAPSHOT.rebuildIntervalMs;

  let json: string | null;
  if (cached?.json && (upToDate || recentEnough)) {
    json = cached.json;
  } else {
    json = await build(db, areaId, now);
    if (json === null) return null;
    // Record which version this build reflects. If a vote lands while we were building,
    // version will already be higher, so the next request rebuilds again.
    await db
      .prepare(
        `INSERT INTO snapshot_cache (area_id, json, built_at, built_version, version)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (area_id) DO UPDATE SET json = ?2, built_at = ?3, built_version = ?4`,
      )
      .bind(areaId, json, isoTime(now), cached?.version ?? 1)
      .run();
  }

  memory.set(areaId, { json, at: now });
  return json;
}

/** Marks an area's snapshot as out of date. Use inside the same batch as the change. */
export function invalidateSnapshot(db: D1Database, areaId: string) {
  return db
    .prepare(
      `INSERT INTO snapshot_cache (area_id, version) VALUES (?1, 2)
       ON CONFLICT (area_id) DO UPDATE SET version = version + 1`,
    )
    .bind(areaId);
}
