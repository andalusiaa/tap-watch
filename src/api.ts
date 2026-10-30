// Talking to the Tap Watch API (same origin, so no CORS needed).

import { AREA_ID } from './config';
import { deviceId } from './device';
import type { VoteDirection } from './rules';
import type { Dispense, ServerListing, Snapshot } from './types';

/** The server ignores writes sent sooner than 2 seconds after the page token was issued. */
const MIN_TOKEN_AGE_MS = 2_500;

let token = '';
let tokenReceivedAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A page token on its own, for pages that don't load the snapshot. `page` names the page so
 * the server can add one to that page's daily total; leave it out and nothing is counted.
 */
async function fetchToken(page = ''): Promise<void> {
  const res = await fetch(`/api/form-token${page ? `?page=${page}` : ''}`, { headers: { Accept: 'application/json' } });
  token = res.headers.get('X-Form-Token') ?? '';
  tokenReceivedAt = Date.now();
}

/** Asks for the page token when a page opens: it counts the visit, and the form is ready sooner. */
export const primeToken = (page: string) => fetchToken(page).catch(() => undefined);

/** The current page token, for anything that posts without going through sendWrite. */
export const pageToken = () => token;

async function fetchSnapshot(page = ''): Promise<Snapshot> {
  const res = await fetch(`/api/snapshot?area=${AREA_ID}${page ? `&page=${page}` : ''}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Snapshot request failed: ${res.status}`);
  token = res.headers.get('X-Form-Token') ?? '';
  tokenReceivedAt = Date.now();
  return (await res.json()) as Snapshot;
}

/** `page` is 'home' for the public page (counted) or 'admin' for the admin page (not counted). */
export const loadSnapshot = (page: 'home' | 'admin') => fetchSnapshot(page === 'home' ? 'home' : '');

export type WriteResult<T = object> =
  | ({ ok: true } & Partial<T>)
  | { ok: false; error: string; message: string };

/** Sends a public write with the page token and spam-trap value, retrying once if the page token has expired. */
async function sendWrite<T>(url: string, makeBody: (token: string) => BodyInit, json: boolean): Promise<WriteResult<T>> {
  const post = async () => {
    const wait = tokenReceivedAt + MIN_TOKEN_AGE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const id = deviceId();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        // Tells the server this device apart from the next one. Left out when the browser
        // can't store it; the server then falls back to the address and browser.
        ...(id ? { 'X-Tap-Device': id } : {}),
      },
      body: makeBody(token),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  };

  try {
    let { status, body } = await post();
    if (status === 403 && body.error === 'page_expired') {
      // The snapshot carries a token too, but a plain token is enough to retry with.
      await (document.getElementById('results') ? fetchSnapshot() : fetchToken());
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

export async function sendFeedback(message: string, honeypot: string) {
  if (!token) await fetchToken();
  return sendWrite('/api/feedback', (t) => JSON.stringify({ message, hp: honeypot, token: t }), true);
}

export function sendVote(listingId: number, direction: VoteDirection, honeypot: string) {
  return sendWrite<{ listing: ServerListing }>(
    '/api/vote',
    (t) => JSON.stringify({ listing_id: listingId, direction, hp: honeypot, token: t }),
    true,
  );
}

export function sendPhotoReport(
  pubId: string,
  photos: { blob: Blob; takenAt: Date | null }[],
  note: string,
  honeypot: string,
) {
  return sendWrite(
    '/api/report',
    (t) => {
      const form = new FormData();
      form.set('pub_id', pubId);
      form.set('note', note);
      form.set('hp', honeypot);
      form.set('token', t);
      photos.forEach((photo, i) => {
        form.append('photo', photo.blob, `taps-${i + 1}.jpg`);
        // One entry per photo, in the same order. Empty when the file didn't say.
        form.append('taken_at', photo.takenAt ? photo.takenAt.toISOString() : '');
      });
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
