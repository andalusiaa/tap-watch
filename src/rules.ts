// "Still on?" vote rules (SPEC sections 6.3 and 8).
// Written without browser APIs so the Phase 2 API can reuse it.

import type { Listing } from './types';

export type VoteDirection = 1 | -1;

/** A listing's status including the one the public never sees. */
export type AnyStatus = Listing['status'] | 'removed';

export interface VoteContext {
  now: string;
  /** For a 👎 on a reported-gone listing: true if this device isn't the one that reported it gone. */
  fromDifferentDevice: boolean;
  /** For a 👍 on an unconfirmed listing: true if this device is the one that reported the beer. */
  fromSubmitter?: boolean;
}

export interface VoteOutcome {
  status: AnyStatus;
  last_confirmed_at: string | null;
  reported_gone_at: string | null;
}

export function applyVote(
  listing: Pick<Listing, 'last_confirmed_at' | 'reported_gone_at'> & { status: AnyStatus },
  direction: VoteDirection,
  { now, fromDifferentDevice, fromSubmitter = false }: VoteContext,
): VoteOutcome {
  if (listing.status === 'removed') {
    // Removed listings are hidden, so a public vote can't reach them. Only admin can restore.
    return { ...listing };
  }

  if (direction === 1) {
    // A beer someone reported stays unconfirmed until somebody else sees it: confirming your
    // own report would prove nothing. The vote is still counted, so the buttons settle down.
    if (listing.status === 'likely' && fromSubmitter) return { ...listing };
    return { status: 'confirmed', last_confirmed_at: now, reported_gone_at: null };
  }

  if (listing.status === 'reported_gone') {
    return fromDifferentDevice ? { ...listing, status: 'removed' } : { ...listing };
  }

  return { ...listing, status: 'reported_gone', reported_gone_at: now };
}
