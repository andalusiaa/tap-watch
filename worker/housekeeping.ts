// Daily clean-up, run by the Cron Trigger in wrangler.jsonc (SPEC section 7).

import { PHOTOS, PRIVACY } from './config';
import { isoTime } from './http';
import { rotateSalt } from './security';

export async function housekeeping(env: Env, now: number) {
  const db = env.DB;
  const hashCutoff = isoTime(now - PRIVACY.deviceHashMaxAgeMs);
  const photoCutoff = isoTime(now - PHOTOS.maxPendingMs);

  const [votes, reports, suggestions, limits, staleReports] = await db.batch<{ id: number }>([
    // Forget which device sent each vote, report and suggestion once it is 30 days old.
    db.prepare('UPDATE votes SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < ?').bind(hashCutoff),
    db.prepare('UPDATE photo_reports SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < ?').bind(hashCutoff),
    db.prepare('UPDATE suggestions SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < ?').bind(hashCutoff),
    db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(isoTime(now)),
    // Reports nobody checked within 30 days. Each photo deletion is a subrequest (50 allowed
    // per run on the free plan), so take up to 10 reports (40 photos) a day; the store also
    // expires photos after 31 days.
    db.prepare(`SELECT id FROM photo_reports WHERE status = 'pending' AND created_at < ? LIMIT 10`).bind(photoCutoff),
  ]);

  const expired = (staleReports?.results ?? []).map((r) => r.id);
  if (expired.length) {
    const list = expired.map(() => '?').join(', ');
    const images = await db
      .prepare(`SELECT photo_key FROM photo_report_images WHERE photo_key IS NOT NULL AND report_id IN (${list})`)
      .bind(...expired)
      .all<{ photo_key: string }>();
    await Promise.all(images.results.map((i) => env.PHOTOS.delete(i.photo_key)));
    await db.batch([
      db.prepare(`UPDATE photo_report_images SET photo_key = NULL WHERE report_id IN (${list})`).bind(...expired),
      db.prepare(`UPDATE photo_reports SET status = 'rejected', reviewed_at = ? WHERE id IN (${list})`).bind(isoTime(now), ...expired),
    ]);
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
