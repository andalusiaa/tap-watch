// Counting what the site gets used for: which beers people search for, which pubs they open,
// when the map is used. Daily totals only — nothing here says who did anything, and the
// server throws away everything but the date and the count.
//
// Counts are held for a few seconds and sent together, so a burst of typing is one request,
// and the page never waits for it. If the request fails, the counts are simply lost.

import { pageToken } from './api';

type Kind = 'search' | 'miss' | 'pub' | 'map';

const SEND_AFTER_MS = 5_000;
/** Matches the server: anything beyond this in one go is dropped. */
const MAX_WAITING = 10;

const waiting: { kind: Kind; key: string }[] = [];
let timer = 0;

export function tally(kind: Kind, key = ''): void {
  if (waiting.length >= MAX_WAITING) return;
  waiting.push({ kind, key: key.slice(0, 40) });
  if (!timer) timer = window.setTimeout(send, SEND_AFTER_MS);
}

function send(): void {
  clearTimeout(timer);
  timer = 0;
  if (!waiting.length) return;
  const body = JSON.stringify({ token: pageToken(), events: waiting.splice(0) });
  try {
    const parcel = new Blob([body], { type: 'application/json' });
    // sendBeacon survives the page closing; fetch is the fallback if it won't take it.
    if (!navigator.sendBeacon('/api/count', parcel)) {
      void fetch('/api/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch {
    // Counting must never get in the way of using the site.
  }
}

/** A search that found nothing is only counted once the typing stops. */
let missTimer = 0;
export function tallyMiss(query: string): void {
  clearTimeout(missTimer);
  const text = query.trim();
  if (text.length < 3) return;
  missTimer = window.setTimeout(() => tally('miss', text), 2_000);
}

export function cancelMiss(): void {
  clearTimeout(missTimer);
}

addEventListener('pagehide', send);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) send();
});
