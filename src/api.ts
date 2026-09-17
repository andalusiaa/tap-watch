// Talking to the Tap Watch API (same origin, so no cookies or CORS needed).

import { AREA_ID } from './config';
import type { VoteDirection } from './rules';
import type { ServerListing, Snapshot } from './types';

/** The server ignores writes sent sooner than 2 seconds after the page token was issued. */
const MIN_TOKEN_AGE_MS = 2_500;

let token = '';
let tokenReceivedAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSnapshot(): Promise<Snapshot> {
  const res = await fetch(`/api/snapshot?area=${AREA_ID}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Snapshot request failed: ${res.status}`);
  token = res.headers.get('X-Form-Token') ?? '';
  tokenReceivedAt = Date.now();
  return (await res.json()) as Snapshot;
}

export const loadSnapshot = fetchSnapshot;

export type VoteResult =
  | { ok: true; listing?: ServerListing }
  | { ok: false; error: string; message: string };

const networkError: VoteResult = {
  ok: false,
  error: 'network',
  message: "We couldn't reach Tap Watch. Check your connection and try again.",
};

async function post(listingId: number, direction: VoteDirection, honeypot: string) {
  const wait = tokenReceivedAt + MIN_TOKEN_AGE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  const res = await fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ listing_id: listingId, direction, hp: honeypot, token }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

export async function sendVote(listingId: number, direction: VoteDirection, honeypot: string): Promise<VoteResult> {
  try {
    let { status, body } = await post(listingId, direction, honeypot);
    if (status === 403 && body.error === 'page_expired') {
      // The page has been open a long time: get a fresh token and try once more.
      await fetchSnapshot();
      ({ status, body } = await post(listingId, direction, honeypot));
    }
    if (status === 200 && body.ok) {
      return { ok: true, listing: body.listing as ServerListing | undefined };
    }
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : 'server_error',
      message: typeof body.message === 'string' ? body.message : 'Something went wrong. Please try again.',
    };
  } catch {
    return networkError;
  }
}
