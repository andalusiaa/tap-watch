// Daily clean-up, run by the Cron Trigger in wrangler.jsonc (SPEC section 7).

import { PRIVACY } from './config';
import { isoTime } from './http';
import { rotateSalt } from './security';

export async function housekeeping(db: D1Database, now: number) {
  const [hashes, limits] = await db.batch([
    // Forget which device cast each vote once it is 30 days old (the vote itself stays).
    db.prepare('UPDATE votes SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < ?').bind(
      isoTime(now - PRIVACY.deviceHashMaxAgeMs),
    ),
    db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(isoTime(now)),
  ]);

  const salt = await db
    .prepare('SELECT created_at FROM device_salts ORDER BY id DESC LIMIT 1')
    .first<{ created_at: string }>();
  const rotated = !salt || now - Date.parse(salt.created_at) > PRIVACY.saltMaxAgeMs;
  if (rotated) await rotateSalt(db, now);

  console.log(
    `Housekeeping: cleared ${hashes?.meta.changes ?? 0} device hashes, ` +
      `deleted ${limits?.meta.changes ?? 0} expired counters, salt rotated: ${rotated}`,
  );
}
