import { AGEING_MAX_DAYS, FRESH_MAX_DAYS } from './config';
import type { Listing } from './types';

export type Freshness = 'fresh' | 'ageing' | 'stale' | 'likely' | 'gone';

const DAY_MS = 86_400_000;
const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

/** Whole days between an ISO timestamp and now (0 = within the last 24 hours). */
export function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS));
}

/** "today", "yesterday", "3 days ago", "5 weeks ago", "3 months ago", "2 years ago". */
export function timeAgo(iso: string, now: number): string {
  const days = daysSince(iso, now);
  if (days < 14) return relative.format(-days, 'day');
  if (days < 60) return relative.format(-Math.round(days / 7), 'week');
  if (days < 365) return relative.format(-Math.round(days / 30.44), 'month');
  return relative.format(-Math.round(days / 365.25), 'year');
}

export function freshnessOf(listing: Listing, now: number): { state: Freshness; label: string } {
  if (listing.status === 'reported_gone') {
    const when = listing.reported_gone_at ? ` ${timeAgo(listing.reported_gone_at, now)}` : '';
    return { state: 'gone', label: `Reported gone${when}` };
  }
  if (!listing.last_confirmed_at) {
    return { state: 'likely', label: 'Likely — not yet checked' };
  }
  const days = daysSince(listing.last_confirmed_at, now);
  const ago = timeAgo(listing.last_confirmed_at, now);
  if (days <= FRESH_MAX_DAYS) return { state: 'fresh', label: `Checked ${ago}` };
  if (days <= AGEING_MAX_DAYS) return { state: 'ageing', label: `Checked ${ago}` };
  return { state: 'stale', label: `Last checked ${ago}` };
}

/** Sort key: lower is fresher. Likely comes after any confirmed; gone comes last. */
export function freshnessRank(listing: Listing, now: number): number {
  if (listing.status === 'reported_gone') return Number.MAX_SAFE_INTEGER;
  if (!listing.last_confirmed_at) return Number.MAX_SAFE_INTEGER - 1;
  return daysSince(listing.last_confirmed_at, now);
}
