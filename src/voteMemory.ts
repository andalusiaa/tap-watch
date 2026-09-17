// Remembers this device's votes for 24 hours, in localStorage. A UI hint only: the server
// enforces the real limit. Also keeps the server's reply, so a reload straight after voting
// shows the vote even if the shared snapshot hasn't caught up yet.

import type { ServerListing } from './types';

const KEY = 'tw-votes';
const DAY_MS = 86_400_000;

interface Remembered {
  at: number;
  listing?: ServerListing;
}

function read(): Record<string, Remembered> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Remembered>) : {};
  } catch {
    return {};
  }
}

function write(votes: Record<string, Remembered>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(votes));
  } catch {
    // Storage unavailable (private browsing): the hint just won't survive a reload.
  }
}

function recent(now = Date.now()): Record<string, Remembered> {
  const all = read();
  const kept = Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v?.at === 'number' && now - v.at < DAY_MS));
  if (Object.keys(kept).length !== Object.keys(all).length) write(kept);
  return kept;
}

const session = new Map<number, Remembered>();

export const voteMemory = {
  hasVoted(listingId: number): boolean {
    return session.has(listingId) || String(listingId) in recent();
  },

  remember(listingId: number, listing?: ServerListing) {
    const entry = { at: Date.now(), listing };
    session.set(listingId, entry);
    write({ ...recent(), [listingId]: entry });
  },

  forget(listingId: number) {
    session.delete(listingId);
    const votes = recent();
    delete votes[listingId];
    write(votes);
  },

  /** Listings this device changed after the given time. */
  newerThan(iso: string): ServerListing[] {
    const since = Date.parse(iso);
    return Object.values(recent())
      .filter((v) => v.at > since && v.listing)
      .map((v) => v.listing as ServerListing);
  },
};
