// Talking to the Tap Watch API (same origin, so no CORS needed).

import { AREA_ID } from './config';
import type { VoteDirection } from './rules';
import type { Dispense, ServerListing, Snapshot } from './types';

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

export type WriteResult<T = object> =
  | ({ ok: true } & Partial<T>)
  | { ok: false; error: string; message: string };

/** Sends a public write with the page token and spam-trap value, retrying once if the page token has expired. */
async function sendWrite<T>(url: string, makeBody: (token: string) => BodyInit, json: boolean): Promise<WriteResult<T>> {
  const post = async () => {
    const wait = tokenReceivedAt + MIN_TOKEN_AGE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const res = await fetch(url, {
      method: 'POST',
      headers: json ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: makeBody(token),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  };

  try {
    let { status, body } = await post();
    if (status === 403 && body.error === 'page_expired') {
      await fetchSnapshot();
      ({ status, body } = await post());
    }
    if (status === 200 && body.ok) return body as { ok: true } & Partial<T>;
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : 'server_error',
      message: typeof body.message === 'string' ? body.message : 'Something went wrong. Please try again.',
    };
  } catch {
    return { ok: false, error: 'network', message: "We couldn't reach Tap Watch. Check your connection and try again." };
  }
}

export function sendVote(listingId: number, direction: VoteDirection, honeypot: string) {
  return sendWrite<{ listing: ServerListing }>(
    '/api/vote',
    (t) => JSON.stringify({ listing_id: listingId, direction, hp: honeypot, token: t }),
    true,
  );
}

export function sendPhotoReport(pubId: string, photo: Blob, note: string, honeypot: string) {
  return sendWrite(
    '/api/report',
    (t) => {
      const form = new FormData();
      form.set('pub_id', pubId);
      form.set('note', note);
      form.set('hp', honeypot);
      form.set('token', t);
      form.set('photo', photo, 'taps.jpg');
      return form;
    },
    false,
  );
}

export function sendSuggestion(
  suggestion: { pubId: string | null; beerId: string | null; proposedName: string | null; dispense: Dispense | null },
  honeypot: string,
) {
  return sendWrite(
    '/api/suggest',
    (t) =>
      JSON.stringify({
        pub_id: suggestion.pubId,
        beer_id: suggestion.beerId,
        proposed_beer_name: suggestion.proposedName,
        dispense: suggestion.dispense,
        hp: honeypot,
        token: t,
      }),
    true,
  );
}
