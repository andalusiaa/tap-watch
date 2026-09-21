// The admin Activity tab (GET /api/admin/activity): votes, photo reports, beer submissions and
// admin changes, newest first, plus the busiest visitors of the last 30 days.
//
// Visitors appear as a friendly label ("Amber Otter 17") made from the device hash that is
// already stored for 30 days. The hash itself never leaves the server, and nothing new is
// stored about visitors. The label changes when the hash salt rotates (every 30 days).

import { ADMIN_LOG, PRIVACY } from './config';
import { badRequest, isoTime, json } from './http';

const ADJECTIVES = [
  'Amber', 'Bold', 'Brisk', 'Bright', 'Calm', 'Clever', 'Copper', 'Crisp', 'Dapper', 'Dusky', 'Eager', 'Fizzy',
  'Frothy', 'Gentle', 'Gilded', 'Golden', 'Hazy', 'Hoppy', 'Jolly', 'Keen', 'Lively', 'Lucky', 'Malty', 'Mellow',
  'Merry', 'Misty', 'Nimble', 'Noble', 'Nutty', 'Plucky', 'Quiet', 'Rapid', 'Ruby', 'Rustic', 'Sable', 'Salty',
  'Silver', 'Sleek', 'Smoky', 'Snug', 'Sparky', 'Spry', 'Steady', 'Stout', 'Sunny', 'Swift', 'Tawny', 'Tidy',
  'Toasty', 'Velvet', 'Vivid', 'Wandering', 'Warm', 'Wily', 'Witty', 'Zesty', 'Brave', 'Cosy', 'Dizzy', 'Early',
  'Fancy', 'Hearty', 'Humble', 'Rosy',
];
const ANIMALS = [
  'Badger', 'Bat', 'Beaver', 'Bee', 'Crane', 'Crow', 'Deer', 'Dove', 'Duck', 'Eel', 'Egret', 'Falcon', 'Ferret',
  'Finch', 'Fox', 'Frog', 'Gull', 'Hare', 'Hawk', 'Hedgehog', 'Heron', 'Jay', 'Kestrel', 'Kingfisher', 'Lark',
  'Magpie', 'Marten', 'Mole', 'Moth', 'Newt', 'Otter', 'Owl', 'Pike', 'Plover', 'Puffin', 'Rabbit', 'Raven',
  'Robin', 'Rook', 'Salmon', 'Seal', 'Shrew', 'Skylark', 'Sparrow', 'Squirrel', 'Starling', 'Stoat', 'Swan',
  'Swift', 'Tern', 'Thrush', 'Toad', 'Trout', 'Vole', 'Weasel', 'Wren', 'Coot', 'Curlew', 'Dunnock', 'Grebe',
  'Linnet', 'Martin', 'Pigeon', 'Teal',
];

/** "Amber Otter 17" from a device hash (hex). Same device and salt, same label. */
export function visitorLabel(hash: string | null): string | null {
  if (!hash || !/^[0-9a-f]{8,}$/.test(hash)) return null;
  const n = parseInt(hash.slice(0, 8), 16);
  return `${ADJECTIVES[n % 64]} ${ANIMALS[Math.floor(n / 64) % 64]} ${Math.floor(n / 4096) % 100}`;
}

export function logAdmin(db: D1Database, now: number, action: string, pubId: string | null, summary: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO admin_log (created_at, action, pub_id, summary) VALUES (?, ?, ?, ?)')
    .bind(isoTime(now), action, pubId, summary.slice(0, 1000));
}

const TYPES = new Set(['all', 'votes', 'reports', 'submissions', 'admin']);
const PAGE = 60;

interface Entry {
  kind: 'vote' | 'report' | 'submission' | 'admin';
  at: string;
  pub_id: string | null;
  pub_name: string | null;
  visitor: string | null;
  text: string;
  status?: string;
}

export async function getActivity(env: Env, url: URL, now: number): Promise<Response> {
  const type = url.searchParams.get('type') ?? 'all';
  const pub = url.searchParams.get('pub') || null;
  const before = url.searchParams.get('before') || isoTime(now + 60_000);
  if (!TYPES.has(type) || (pub && !/^[a-z0-9-]{1,80}$/.test(pub)) || Number.isNaN(Date.parse(before))) throw badRequest();
  const want = (t: string) => type === 'all' || type === t;
  const db = env.DB;
  const since = isoTime(now - PRIVACY.deviceHashMaxAgeMs);

  const queries: [string, D1PreparedStatement][] = [];
  if (want('votes')) {
    queries.push(['vote', db.prepare(
      `SELECT v.created_at AS at, v.direction, v.device_hash, l.pub_id, p.name AS pub_name, b.name AS beer_name, l.dispense
       FROM votes v JOIN listings l ON l.id = v.listing_id JOIN pubs p ON p.id = l.pub_id JOIN beers b ON b.id = l.beer_id
       WHERE v.created_at < ?1 AND (?2 IS NULL OR l.pub_id = ?2) ORDER BY v.created_at DESC LIMIT ?3`,
    ).bind(before, pub, PAGE)]);
  }
  if (want('reports')) {
    queries.push(['report', db.prepare(
      `SELECT r.created_at AS at, r.status, r.device_hash, r.pub_id, p.name AS pub_name, r.note,
              (SELECT COUNT(*) FROM photo_report_images i WHERE i.report_id = r.id) AS photos
       FROM photo_reports r JOIN pubs p ON p.id = r.pub_id
       WHERE r.created_at < ?1 AND (?2 IS NULL OR r.pub_id = ?2) ORDER BY r.created_at DESC LIMIT ?3`,
    ).bind(before, pub, PAGE)]);
  }
  if (want('submissions')) {
    queries.push(['submission', db.prepare(
      `SELECT s.created_at AS at, s.status, s.device_hash, s.pub_id, p.name AS pub_name,
              COALESCE(b.name, s.proposed_beer_name) AS beer_name, s.dispense
       FROM suggestions s LEFT JOIN pubs p ON p.id = s.pub_id LEFT JOIN beers b ON b.id = s.beer_id
       WHERE s.created_at < ?1 AND (?2 IS NULL OR s.pub_id = ?2) ORDER BY s.created_at DESC LIMIT ?3`,
    ).bind(before, pub, PAGE)]);
  }
  if (want('admin')) {
    queries.push(['admin', db.prepare(
      `SELECT a.created_at AS at, a.action, a.pub_id, p.name AS pub_name, a.summary
       FROM admin_log a LEFT JOIN pubs p ON p.id = a.pub_id
       WHERE a.created_at < ?1 AND (?2 IS NULL OR a.pub_id = ?2) ORDER BY a.created_at DESC LIMIT ?3`,
    ).bind(before, pub, PAGE)]);
  }
  // The busiest visitors of the last 30 days (after that, device hashes are wiped).
  const visitorsQuery = db.prepare(
    `SELECT device_hash, SUM(kind = 'v') AS votes, SUM(kind = 'r') AS reports, SUM(kind = 's') AS submissions, MAX(created_at) AS last_at
     FROM (
       SELECT device_hash, 'v' AS kind, created_at FROM votes WHERE device_hash IS NOT NULL AND created_at >= ?1
       UNION ALL SELECT device_hash, 'r', created_at FROM photo_reports WHERE device_hash IS NOT NULL AND created_at >= ?1
       UNION ALL SELECT device_hash, 's', created_at FROM suggestions WHERE device_hash IS NOT NULL AND created_at >= ?1
     )
     GROUP BY device_hash ORDER BY reports + submissions DESC, votes DESC LIMIT 15`,
  ).bind(since);

  const results = await db.batch<Record<string, unknown>>([...queries.map(([, q]) => q), visitorsQuery]);
  const entries: Entry[] = [];
  let full = false;
  queries.forEach(([kind], i) => {
    const rows = results[i]?.results ?? [];
    if (rows.length === PAGE) full = true;
    for (const r of rows) {
      const base = {
        at: String(r.at),
        pub_id: (r.pub_id as string | null) ?? null,
        pub_name: (r.pub_name as string | null) ?? null,
        visitor: visitorLabel((r.device_hash as string | null) ?? null),
      };
      if (kind === 'vote') {
        entries.push({ ...base, kind, text: `${r.direction === 1 ? '👍 Still on' : '👎 Gone'}: ${r.beer_name} (${r.dispense})` });
      } else if (kind === 'report') {
        const photos = Number(r.photos);
        const note = r.note ? `, note: "${String(r.note).slice(0, 120)}"` : '';
        entries.push({ ...base, kind, status: String(r.status), text: `Sent ${photos} ${photos === 1 ? 'photo' : 'photos'}${note}` });
      } else if (kind === 'submission') {
        entries.push({ ...base, kind, status: String(r.status), text: `Submitted ${r.beer_name}${r.dispense ? ` (${r.dispense})` : ''}` });
      } else {
        entries.push({ ...base, kind: 'admin', visitor: null, status: String(r.action), text: String(r.summary) });
      }
    }
  });
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const page = entries.slice(0, PAGE);
  const more = full || entries.length > PAGE;

  const visitors = (results[queries.length]?.results ?? []).map((v) => ({
    visitor: visitorLabel(v.device_hash as string),
    votes: Number(v.votes),
    reports: Number(v.reports),
    submissions: Number(v.submissions),
    last_at: String(v.last_at),
  }));

  return json({
    entries: page,
    next: more && page.length ? page[page.length - 1]?.at : null,
    visitors: before > isoTime(now) ? visitors : undefined,
    log_days: ADMIN_LOG.keepDays,
  });
}
