// The admin usage page: today's activity and how close Tap Watch is to its limits.
//
// Tap Watch can only see what it counts itself. Cloudflare's own totals (page loads,
// rows read) are on the Cloudflare dashboard; the page links there.

import { LIMITS } from './config';
import { isoTime, json } from './http';
import { readCounter, writeBudgetKey } from './security';

const DAYS_SHOWN = 7;

interface DayCount {
  day: string;
  n: number;
}

/** Counts per UTC day since `since`. Rows younger than 30 days still have a device hash, so the partial indexes cover this. */
async function perDay(db: D1Database, table: 'votes' | 'photo_reports' | 'suggestions', since: string): Promise<DayCount[]> {
  const { results } = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM ${table}
       WHERE created_at >= ? AND device_hash IS NOT NULL GROUP BY day`,
    )
    .bind(since)
    .all<DayCount>();
  return results;
}

export async function getUsage(env: Env, now: number): Promise<Response> {
  const db = env.DB;
  const today = isoTime(now).slice(0, 10);
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => isoTime(now - i * 86_400_000).slice(0, 10));
  const since = `${days[days.length - 1]}T00:00:00.000Z`;

  const [votes, reports, suggestions, writes, photosToday, stored, size] = await Promise.all([
    perDay(db, 'votes', since),
    perDay(db, 'photo_reports', since),
    perDay(db, 'suggestions', since),
    readCounter(db, writeBudgetKey(now).key),
    readCounter(db, `photos:${today}`),
    db
      .prepare(`SELECT COUNT(*) AS photos, COALESCE(SUM(photo_bytes), 0) AS bytes FROM photo_report_images WHERE photo_key IS NOT NULL`)
      .first<{ photos: number; bytes: number }>(),
    // Any query reports the database size; this one reads no rows.
    db.prepare('SELECT 1').run(),
  ]);

  const countOn = (list: DayCount[], day: string) => list.find((r) => r.day === day)?.n ?? 0;
  return json({
    now: isoTime(now),
    today: {
      votes: countOn(votes, today),
      reports: countOn(reports, today),
      suggestions: countOn(suggestions, today),
      photos: photosToday,
      writes,
    },
    days: days.map((day) => ({
      day,
      votes: countOn(votes, day),
      reports: countOn(reports, day),
      suggestions: countOn(suggestions, day),
    })),
    stored_photos: { count: stored?.photos ?? 0, bytes: stored?.bytes ?? 0 },
    database_bytes: size.meta.size_after ?? null,
    caps: {
      daily_write_budget: LIMITS.dailyWriteBudget,
      photos_per_day: LIMITS.photosPerDayTotal,
      reports_per_device_per_day: LIMITS.reportsPerDay,
      photos_per_report: LIMITS.photosPerReport,
      suggestions_per_device_per_day: LIMITS.suggestionsPerDay,
      votes_per_device_per_hour: LIMITS.votesPerHour,
    },
  });
}
