// Daily clean-up, run by the Cron Trigger in wrangler.jsonc (SPEC section 7).

import { PHOTOS, PRIVACY } from './config';
import { isoTime } from './http';
import { rotateSalt } from './security';

export async function housekeeping(env: Env, now: number) {
  const db = env.DB;
  const hashCutoff = isoTime(now - PRIVACY.deviceHashMaxAgeMs);
  const photoCutoff = isoTime(now - PHOTOS.maxPendingMs);

  const [votes, reports, suggestions, limits, stalePhotos] = await db.batch<{ id: number; photo_key: string | null }>([
    // Forget which device sent each vote, report and suggestion once it is 30 days old.
    db.prepare('UPDATE votes SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < ?').bind(hashCutoff),
    db.prepare('UPDATE photo_reports SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < ?').bind(hashCutoff),
    db.prepare('UPDATE suggestions SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < ?').bind(hashCutoff),
    db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(isoTime(now)),
    // Photos nobody checked within 30 days. Each deletion is a subrequest (50 allowed per run
    // on the free plan), so take a batch per day; the store also expires them after 31 days.
    db.prepare(`SELECT id, photo_key FROM photo_reports WHERE status = 'pending' AND created_at < ? LIMIT 40`).bind(photoCutoff),
  ]);

  const expired = stalePhotos?.results ?? [];
  for (const report of expired) {
    if (report.photo_key) await env.PHOTOS.delete(report.photo_key);
  }
  if (expired.length) {
    await db
      .prepare(
        `UPDATE photo_reports SET status = 'rejected', photo_key = NULL, reviewed_at = ?
         WHERE id IN (${expired.map(() => '?').join(', ')})`,
      )
      .bind(isoTime(now), ...expired.map((r) => r.id))
      .run();
  }

  const salt = await db
    .prepare('SELECT created_at FROM device_salts ORDER BY id DESC LIMIT 1')
    .first<{ created_at: string }>();
  const rotated = !salt || now - Date.parse(salt.created_at) > PRIVACY.saltMaxAgeMs;
  if (rotated) await rotateSalt(db, now);

  const cleared = (votes?.meta.changes ?? 0) + (reports?.meta.changes ?? 0) + (suggestions?.meta.changes ?? 0);
  console.log(
    `Housekeeping: cleared ${cleared} device hashes, deleted ${limits?.meta.changes ?? 0} expired counters, ` +
      `expired ${expired.length} unchecked photos, salt rotated: ${rotated}`,
  );
}
