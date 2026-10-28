// The admin home tab: a short list of what needs a look, refreshed while the page is open.
//
//   GET /api/admin/dashboard?area=e17   → counts only, no photos or messages
//
// Counts, not content: the page polls this every half minute, so it stays small and reads
// few rows. Everything it points at is handled on its own tab.

import { AGEING_MAX_DAYS } from '../src/config';
import { LIMITS } from './config';
import { isoTime, json } from './http';
import { readCounter, writeBudgetKey } from './security';

/** Pubs named on the home tab, so one neglected corner of the borough can't fill the card. */
const NAMES_SHOWN = 6;

interface PubRow {
  name: string;
  beers: number;
  last_checked: string | null;
}

export async function getDashboard(env: Env, areaId: string, now: number): Promise<Response> {
  const db = env.DB;
  const today = isoTime(now).slice(0, 10);
  const staleBefore = isoTime(now - AGEING_MAX_DAYS * 86_400_000);

  const [counts, pubs, writes, photos] = await Promise.all([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM photo_reports WHERE status = 'pending') AS reports,
                (SELECT COUNT(*) FROM suggestions WHERE status = 'pending') AS suggestions,
                (SELECT COUNT(*) FROM feedback WHERE status = 'pending') AS ideas,
                (SELECT MIN(created_at) FROM photo_reports WHERE status = 'pending') AS oldest_report,
                (SELECT MIN(created_at) FROM suggestions WHERE status = 'pending') AS oldest_suggestion,
                (SELECT MIN(created_at) FROM feedback WHERE status = 'pending') AS oldest_idea,
                (SELECT is_sample FROM areas WHERE id = ?) AS is_sample`,
      )
      .bind(areaId)
      .first<{
        reports: number;
        suggestions: number;
        ideas: number;
        oldest_report: string | null;
        oldest_suggestion: string | null;
        oldest_idea: string | null;
        is_sample: number | null;
      }>(),
    db
      .prepare(
        `SELECT p.name, COUNT(l.id) AS beers, MAX(l.last_confirmed_at) AS last_checked
         FROM pubs p
         LEFT JOIN listings l ON l.pub_id = p.id AND l.status != 'removed'
         WHERE p.area_id = ? AND p.is_active = 1
         GROUP BY p.id, p.name
         ORDER BY p.name`,
      )
      .bind(areaId)
      .all<PubRow>(),
    readCounter(db, writeBudgetKey(now).key),
    readCounter(db, `photos:${today}`),
  ]);

  const rows = pubs.results;
  const empty = rows.filter((p) => p.beers === 0);
  // Grey on the public site: nothing confirmed within the ageing window.
  const stale = rows.filter((p) => p.beers > 0 && (!p.last_checked || p.last_checked < staleBefore));
  const earliest = (...dates: (string | null)[]) => dates.filter((d): d is string => !!d).sort()[0] ?? null;

  return json({
    now: isoTime(now),
    sample: counts?.is_sample === 1,
    queue: {
      reports: counts?.reports ?? 0,
      suggestions: counts?.suggestions ?? 0,
      oldest_at: earliest(counts?.oldest_report ?? null, counts?.oldest_suggestion ?? null),
    },
    ideas: { pending: counts?.ideas ?? 0, oldest_at: counts?.oldest_idea ?? null },
    pubs: {
      total: rows.length,
      stale_days: AGEING_MAX_DAYS,
      no_beers: { count: empty.length, names: empty.slice(0, NAMES_SHOWN).map((p) => p.name) },
      stale: { count: stale.length, names: stale.slice(0, NAMES_SHOWN).map((p) => p.name) },
    },
    usage: {
      writes,
      write_budget: LIMITS.dailyWriteBudget,
      photos,
      photos_cap: LIMITS.photosPerDayTotal,
    },
  });
}
