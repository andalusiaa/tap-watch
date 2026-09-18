// Public submissions that wait for the admin:
//   POST /api/report   multipart: pub_id, photo (1-4 JPEGs), note?, hp, token   (SPEC section 6.4)
//   POST /api/suggest  { pub_id?, beer_id? | proposed_beer_name?, dispense?, hp, token }   (6.5)

import { LIMITS, PHOTOS } from './config';
import { busy, guardPublicWrite, limitPerDevice } from './guard';
import { ApiError, assertSameOrigin, badRequest, isoTime, json, readJsonBody } from './http';
import { looksLikeJpeg, stripJpegMetadata } from './jpeg';
import { bumpCounter, readCounter } from './security';

const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);

async function activePubExists(db: D1Database, pubId: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM pubs WHERE id = ? AND is_active = 1').bind(pubId).first());
}

const pubNotFound = () => new ApiError(404, 'not_found', "We couldn't find that pub.");

export async function handleReport(request: Request, env: Env, now: number): Promise<Response> {
  assertSameOrigin(request);
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data')) throw badRequest();
  const declared = Number(request.headers.get('Content-Length') ?? NaN);
  if (!Number.isFinite(declared)) throw new ApiError(411, 'length_required', 'Please try sending the photos again.');
  if (declared > LIMITS.maxPhotoBytes * LIMITS.photosPerReport + 100_000) throw tooBig();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest();
  }

  const guard = await guardPublicWrite(request, env, now, { hp: form.get('hp'), token: form.get('token') });
  if (!guard) return json({ ok: true });

  const pubId = form.get('pub_id');
  const note = (form.get('note') ?? '').toString().trim();
  const files = form.getAll('photo');
  if (!isId(pubId)) throw badRequest();
  if (note.length > LIMITS.maxNoteLength) throw new ApiError(400, 'note_too_long', 'Please keep the note under 280 characters.');
  if (files.length === 0) throw notAPhoto();
  if (files.length > LIMITS.photosPerReport) {
    throw new ApiError(400, 'too_many_photos', `Please send up to ${LIMITS.photosPerReport} photos at a time.`);
  }

  const photos: Uint8Array[] = [];
  for (const file of files) {
    if (!(file instanceof File) || file.type !== 'image/jpeg') throw notAPhoto();
    if (file.size > LIMITS.maxPhotoBytes) throw tooBig();
    const raw = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeJpeg(raw)) throw notAPhoto();
    const clean = stripJpegMetadata(raw);
    if (!clean) throw new ApiError(400, 'not_a_photo', "A photo couldn't be read. Please try taking it again.");
    photos.push(clean);
  }

  const db = env.DB;
  const day = isoTime(now).slice(0, 10);
  if ((await readCounter(db, `photos:${day}`)) + photos.length > LIMITS.photosPerDayTotal) throw busy();
  await limitPerDevice(db, 'report-day', guard.device, 'day', LIMITS.reportsPerDay, now,
    "You've sent several photos today. Thanks! Please try again tomorrow.");
  if (!(await activePubExists(db, pubId))) throw pubNotFound();

  const keys = photos.map(() => `reports/${crypto.randomUUID()}`);
  let reportId: number | null = null;
  try {
    await Promise.all(
      photos.map((photo, i) =>
        env.PHOTOS.put(keys[i] ?? '', photo, {
          expirationTtl: PHOTOS.storeTtlSeconds,
          metadata: { pub_id: pubId, content_type: 'image/jpeg' },
        }),
      ),
    );
    const report = await db
      .prepare(
        `INSERT INTO photo_reports (pub_id, note, status, device_hash, created_at)
         VALUES (?, ?, 'pending', ?, ?) RETURNING id`,
      )
      .bind(pubId, note || null, guard.device, isoTime(now))
      .first<{ id: number }>();
    reportId = report?.id ?? null;
    if (reportId === null) throw new Error('Report was not saved');
    await db.batch([
      ...photos.map((photo, i) =>
        db
          .prepare('INSERT INTO photo_report_images (report_id, position, photo_key, photo_bytes) VALUES (?, ?, ?, ?)')
          .bind(reportId, i + 1, keys[i], photo.length),
      ),
      bumpCounter(db, `photos:${day}`, photos.length, now + 2 * 86_400_000),
      bumpCounter(db, guard.budget.key, LIMITS.reportWriteCost + LIMITS.photoWriteCost * photos.length, guard.budget.expiresAt),
    ]);
  } catch (error) {
    // Don't leave half a report behind.
    await Promise.all(keys.map((key) => env.PHOTOS.delete(key)));
    if (reportId !== null) await db.prepare('DELETE FROM photo_reports WHERE id = ?').bind(reportId).run();
    throw error;
  }

  return json({ ok: true });
}

const notAPhoto = () =>
  new ApiError(400, 'not_a_photo', "That doesn't look like a photo. Please choose pictures of the taps.");
const tooBig = () => new ApiError(413, 'too_big', 'That photo is too large. Please try a smaller one, or fewer photos.');

export async function handleSuggest(request: Request, env: Env, now: number): Promise<Response> {
  assertSameOrigin(request);
  const body = await readJsonBody(request, 2_000);

  const guard = await guardPublicWrite(request, env, now, { hp: body.hp, token: body.token });
  if (!guard) return json({ ok: true });

  const pubId = body.pub_id ?? null;
  const beerId = body.beer_id ?? null;
  const proposed = typeof body.proposed_beer_name === 'string' ? body.proposed_beer_name.trim().replace(/\s+/g, ' ') : null;
  const dispense = body.dispense ?? null;

  if (pubId !== null && !isId(pubId)) throw badRequest();
  if (beerId !== null && !isId(beerId)) throw badRequest();
  if (dispense !== null && dispense !== 'cask' && dispense !== 'keg') throw badRequest();
  if (!beerId && !proposed) throw new ApiError(400, 'no_beer', 'Please tell us which beer.');
  if (proposed && proposed.length > LIMITS.maxBeerNameLength) {
    throw new ApiError(400, 'name_too_long', 'Please keep the beer name under 80 characters.');
  }

  const db = env.DB;
  await limitPerDevice(db, 'suggest-day', guard.device, 'day', LIMITS.suggestionsPerDay, now,
    "You've sent lots of suggestions today. Thanks! Please try again tomorrow.");
  if (pubId && !(await activePubExists(db, pubId))) throw pubNotFound();
  if (beerId && !(await db.prepare('SELECT 1 FROM beers WHERE id = ? AND is_active = 1').bind(beerId).first())) {
    throw new ApiError(404, 'not_found', "We couldn't find that beer in our list.");
  }

  await db.batch([
    db.prepare(
      `INSERT INTO suggestions (pub_id, beer_id, proposed_beer_name, dispense, status, device_hash, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(pubId, beerId, beerId ? null : proposed, dispense, guard.device, isoTime(now)),
    bumpCounter(db, guard.budget.key, LIMITS.suggestionWriteCost, guard.budget.expiresAt),
  ]);

  return json({ ok: true });
}
