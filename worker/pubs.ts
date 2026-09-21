// Admin editing of pubs, operators and the prototype banner. Called from admin.ts after sign-in.
//
//   GET  /api/admin/pubs?area=e17        → every pub in the area (closed ones too), operators, banner state
//   POST /api/admin/pubs                 { pub } → adds a pub
//   POST /api/admin/pubs/:id             { pub } → changes a pub
//   POST /api/admin/area/:id/sample      { sample } → shows or hides the "made up for testing" banner

import { ApiError, badRequest, isoTime, json, readJsonBody } from './http';
import { logAdmin } from './activity';
import { invalidateSnapshot } from './snapshot';
import { slugify } from './text';

const OPERATOR_TYPES = new Set(['pubco', 'brewery', 'independent']);
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/;

interface PubInput {
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  venue_type: 'pub' | 'bar';
  is_active: boolean;
  /** An existing operator, or null for none. Ignored when new_operator is given. */
  operator_id: string | null;
  new_operator: { name: string; type: string } | null;
}

const text = (value: unknown, max: number): string => {
  if (typeof value !== 'string') throw badRequest();
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length > max) throw badRequest();
  return trimmed;
};

function parsePub(value: unknown, bbox: [number, number, number, number]): PubInput {
  if (typeof value !== 'object' || value === null) throw badRequest();
  const p = value as Record<string, unknown>;
  const name = text(p.name, 80);
  if (!name) throw new ApiError(400, 'bad_request', 'Give the pub a name.');
  const postcode = text(p.postcode ?? '', 8).toUpperCase();
  if (postcode && !POSTCODE.test(postcode)) throw new ApiError(400, 'bad_request', `"${postcode}" doesn't look like a postcode.`);
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
    throw new ApiError(400, 'bad_request', 'The map position is outside the area. Use the postcode to set it.');
  }
  let newOperator: PubInput['new_operator'] = null;
  if (p.new_operator != null) {
    const o = p.new_operator as Record<string, unknown>;
    const operatorName = text(o.name, 80);
    if (!operatorName || typeof o.type !== 'string' || !OPERATOR_TYPES.has(o.type)) {
      throw new ApiError(400, 'bad_request', 'Give the new operator a name and type.');
    }
    newOperator = { name: operatorName, type: o.type };
  }
  const operatorId = p.operator_id == null || p.operator_id === '' ? null : text(p.operator_id, 80);
  return {
    name,
    address: text(p.address ?? '', 120),
    postcode,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    venue_type: p.venue_type === 'bar' ? 'bar' : 'pub',
    is_active: p.is_active !== false,
    operator_id: operatorId,
    new_operator: newOperator,
  };
}

async function areaBbox(db: D1Database, areaId: string): Promise<[number, number, number, number]> {
  const area = await db.prepare('SELECT bbox FROM areas WHERE id = ?').bind(areaId).first<{ bbox: string }>();
  if (!area) throw new ApiError(404, 'not_found', "We couldn't find that area.");
  return JSON.parse(area.bbox) as [number, number, number, number];
}

/** Returns the operator id to use, and a statement adding a new operator if one was given. */
async function resolveOperator(db: D1Database, pub: PubInput): Promise<{ id: string | null; insert: D1PreparedStatement | null }> {
  if (pub.new_operator) {
    const base = slugify(pub.new_operator.name) || 'operator';
    const taken = await db.prepare('SELECT id FROM operators WHERE id = ? OR lower(name) = lower(?)').bind(base, pub.new_operator.name).first<{ id: string }>();
    if (taken) return { id: taken.id, insert: null };
    return {
      id: base,
      insert: db.prepare('INSERT INTO operators (id, name, type) VALUES (?, ?, ?)').bind(base, pub.new_operator.name, pub.new_operator.type),
    };
  }
  if (pub.operator_id === null) return { id: null, insert: null };
  const exists = await db.prepare('SELECT id FROM operators WHERE id = ?').bind(pub.operator_id).first();
  if (!exists) throw new ApiError(400, 'bad_request', 'Choose an operator from the list.');
  return { id: pub.operator_id, insert: null };
}

export async function listPubs(env: Env, areaId: string): Promise<Response> {
  const db = env.DB;
  const [area, pubs, operators] = await db.batch([
    db.prepare('SELECT id, is_sample FROM areas WHERE id = ?').bind(areaId),
    db.prepare(
      `SELECT id, name, address, postcode, lat, lng, venue_type, operator_id, is_active,
              (SELECT COUNT(*) FROM listings l WHERE l.pub_id = pubs.id AND l.status != 'removed') AS beers
       FROM pubs WHERE area_id = ? ORDER BY name`,
    ).bind(areaId),
    db.prepare('SELECT id, name, type FROM operators ORDER BY name'),
  ]);
  const row = area?.results[0] as { is_sample: number } | undefined;
  if (!row) throw new ApiError(404, 'not_found', "We couldn't find that area.");
  return json({ sample: row.is_sample === 1, pubs: pubs?.results ?? [], operators: operators?.results ?? [] });
}

export async function addPub(request: Request, env: Env, areaId: string, now: number): Promise<Response> {
  const db = env.DB;
  const body = await readJsonBody(request, 4_000);
  const pub = parsePub(body.pub, await areaBbox(db, areaId));
  const slug = slugify(pub.name).slice(0, 60) || 'pub';
  let id = `${slug}-${areaId}`;
  for (let n = 2; await db.prepare('SELECT 1 FROM pubs WHERE id = ?').bind(id).first(); n++) id = `${slug}-${n}-${areaId}`;
  const operator = await resolveOperator(db, pub);
  const stamp = isoTime(now);
  await db.batch([
    ...(operator.insert ? [operator.insert] : []),
    db
      .prepare(
        `INSERT INTO pubs (id, area_id, name, address, postcode, venue_type, lat, lng, operator_id, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, areaId, pub.name, pub.address, pub.postcode, pub.venue_type, pub.lat, pub.lng, operator.id, pub.is_active ? 1 : 0, stamp, stamp),
    invalidateSnapshot(db, areaId),
    logAdmin(db, now, 'pub_added', id, `Added ${pub.name}${pub.is_active ? '' : ' (closed)'}.`),
  ]);
  return json({ ok: true, id });
}

export async function updatePub(request: Request, env: Env, pubId: string, now: number): Promise<Response> {
  const db = env.DB;
  const existing = await db
    .prepare('SELECT area_id, name, address, postcode, lat, lng, venue_type, operator_id, is_active FROM pubs WHERE id = ?')
    .bind(pubId)
    .first<{
      area_id: string;
      name: string;
      address: string;
      postcode: string;
      lat: number;
      lng: number;
      venue_type: string;
      operator_id: string | null;
      is_active: number;
    }>();
  if (!existing) throw new ApiError(404, 'not_found', "We couldn't find that pub.");
  const body = await readJsonBody(request, 4_000);
  const pub = parsePub(body.pub, await areaBbox(db, existing.area_id));
  const operator = await resolveOperator(db, pub);
  await db.batch([
    ...(operator.insert ? [operator.insert] : []),
    db
      .prepare(
        `UPDATE pubs SET name = ?, address = ?, postcode = ?, venue_type = ?, lat = ?, lng = ?, operator_id = ?,
                is_active = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(pub.name, pub.address, pub.postcode, pub.venue_type, pub.lat, pub.lng, operator.id, pub.is_active ? 1 : 0, isoTime(now), pubId),
    invalidateSnapshot(db, existing.area_id),
    logAdmin(db, now, 'pub_changed', pubId, describePubChanges(existing, pub, operator.id)),
  ]);
  return json({ ok: true, id: pubId });
}

function describePubChanges(
  before: { name: string; address: string; postcode: string; lat: number; lng: number; venue_type: string; operator_id: string | null; is_active: number },
  after: PubInput,
  operatorId: string | null,
): string {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`renamed from ${before.name}`);
  if (before.address !== after.address || before.postcode !== after.postcode) changes.push(`address now ${[after.address, after.postcode].filter(Boolean).join(', ') || 'blank'}`);
  if (before.lat !== after.lat || before.lng !== after.lng) changes.push('map position moved');
  if (before.venue_type !== after.venue_type) changes.push(`now a ${after.venue_type}`);
  if (before.operator_id !== operatorId) changes.push(`operator now ${after.new_operator?.name ?? operatorId ?? 'not known'}`);
  if (!!before.is_active !== after.is_active) changes.push(after.is_active ? 'reopened' : 'marked closed');
  return `${after.name}: ${changes.length ? changes.join('; ') : 'saved with no changes'}.`;
}

export async function setSample(request: Request, env: Env, areaId: string, now: number): Promise<Response> {
  const body = await readJsonBody(request, 200);
  if (typeof body.sample !== 'boolean') throw badRequest();
  const db = env.DB;
  const [result] = await db.batch([
    db.prepare('UPDATE areas SET is_sample = ? WHERE id = ?').bind(body.sample ? 1 : 0, areaId),
    invalidateSnapshot(db, areaId),
    logAdmin(db, now, 'banner', null, body.sample ? 'Test banner turned on.' : 'Test banner turned off.'),
  ]);
  if (!result?.meta.changes) throw new ApiError(404, 'not_found', "We couldn't find that area.");
  return json({ ok: true, sample: body.sample });
}
