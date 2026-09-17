// The pub sheet: a modal dialog that slides up with the pub's beers.

import type { Catalogue } from '../catalogue';
import { GROUPS } from '../config';
import { freshnessRank } from '../freshness';
import { distanceKm, formatDistance, type LatLng } from '../geo';
import type { VoteDirection } from '../rules';
import type { Beer, Listing, Pub } from '../types';
import { h } from './dom';
import { alcoholFreeLabel, dispenseLabel, freshnessBadge, separator } from './labels';

interface Options {
  dialog: HTMLDialogElement;
  catalogue: Catalogue;
  origin: () => LatLng;
  hasVoted: (listingId: number) => boolean;
  /** A message to show by a beer's vote buttons, e.g. why a vote failed. */
  voteNote: (listingId: number) => string | undefined;
  onVote: (listingId: number, direction: VoteDirection) => void;
  onClose: () => void;
}

/** Google Maps on every device. On phones this opens the Google Maps app if it's installed. */
function mapsUrl(pub: Pub): string {
  const q = new URLSearchParams({ api: '1', query: [pub.name, pub.address, pub.postcode].filter(Boolean).join(', ') });
  return `https://www.google.com/maps/search/?${q}`;
}

export function setupPubSheet(o: Options) {
  let currentPubId: string | null = null;
  const distanceText = (pub: Pub) => `${formatDistance(distanceKm(o.origin(), [pub.lat, pub.lng]))} away`;
  const notice = () => o.dialog.querySelector<HTMLElement>('.sheet-notice');

  o.dialog.addEventListener('close', () => {
    currentPubId = null;
    o.onClose();
  });
  // Handle Escape ourselves too, so every browser closes the sheet the same way.
  o.dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      o.dialog.close();
    }
  });
  // A click on the dimmed backdrop lands on the dialog element itself.
  o.dialog.addEventListener('click', (e) => {
    if (e.target === o.dialog) o.dialog.close();
  });

  function voteControls(listing: Listing, beer: Beer, note: string | undefined): HTMLElement | null {
    if (o.hasVoted(listing.id)) {
      // With a note (e.g. "already voted today") the note says it all.
      return note ? null : h('p', { class: 'vote vote--done', tabindex: '-1', 'data-vote-status': '' }, 'Thanks');
    }
    const vote = (direction: VoteDirection) => () => o.onVote(listing.id, direction);
    return h(
      'div',
      { class: 'vote', role: 'group', 'aria-label': `Is ${beer.name} still on?` },
      h('span', { class: 'vote-question', 'aria-hidden': 'true' }, 'Still on?'),
      h('button', { type: 'button', class: 'vote-button', 'aria-label': `Yes, ${beer.name} is still on`, onclick: vote(1) }, '👍'),
      h('button', { type: 'button', class: 'vote-button', 'aria-label': `No, ${beer.name} has gone`, onclick: vote(-1) }, '👎'),
    );
  }

  function tapRow(listing: Listing, now: number): HTMLElement | null {
    const beer = o.catalogue.beer(listing.beer_id);
    if (!beer) return null;
    const gone = listing.status === 'reported_gone';
    const note = o.voteNote(listing.id);
    return h(
      'li',
      { class: gone ? 'tap tap--gone' : 'tap', 'data-listing': String(listing.id) },
      h(
        'p',
        { class: 'tap-name' },
        h('span', { class: 'tap-beer' }, beer.name),
        ' ',
        dispenseLabel(listing.dispense),
        beer.af ? [' ', alcoholFreeLabel(beer)] : null,
      ),
      h('p', { class: 'tap-status' }, freshnessBadge(listing, now)),
      voteControls(listing, beer, note),
      note ? h('p', { class: 'vote-note', tabindex: '-1', 'data-vote-status': '' }, note) : null,
    );
  }

  function render(pub: Pub, now: number) {
    const operator = o.catalogue.operator(pub.operator_id);
    const listings = o.catalogue.listingsAt(pub.id);
    const groupOf = (l: Listing) => {
      const beer = o.catalogue.beer(l.beer_id);
      return beer?.af ? 'alcohol_free' : (beer?.category ?? 'other');
    };

    const groups = GROUPS.map((g) => {
      const inGroup = listings
        .filter((l) => groupOf(l) === g.id)
        .sort(
          (a, b) =>
            Number(a.status === 'reported_gone') - Number(b.status === 'reported_gone') ||
            (o.catalogue.beer(a.beer_id)?.name ?? '').localeCompare(o.catalogue.beer(b.beer_id)?.name ?? '') ||
            freshnessRank(a, now) - freshnessRank(b, now),
        );
      if (inGroup.length === 0) return null;
      return h(
        'section',
        { class: 'tap-group', 'aria-labelledby': `group-${g.id}` },
        h('h3', { id: `group-${g.id}` }, g.label),
        h('ul', { class: 'taps' }, inGroup.map((l) => tapRow(l, now))),
      );
    });

    const comingSoon = (what: string) => () => {
      const el = notice();
      if (el) el.textContent = `${what} is coming soon. For now, this is a prototype.`;
    };

    o.dialog.replaceChildren(
      h(
        'div',
        { class: 'sheet-inner' },
        h(
          'header',
          { class: 'sheet-header' },
          h('h2', { id: 'sheet-title' }, pub.name),
          h('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Close', onclick: () => o.dialog.close() }, '✕'),
        ),
        h('p', { class: 'sheet-address' }, [pub.address, pub.postcode].filter(Boolean).join(', ')),
        h(
          'p',
          { class: 'sheet-meta' },
          operator ? [h('span', null, operator.name), separator()] : null,
          h('span', { class: 'sheet-distance' }, distanceText(pub)),
          separator(),
          h('a', { href: mapsUrl(pub), target: '_blank', rel: 'noopener noreferrer' }, 'Open in maps'),
        ),
        listings.length === 0
          ? h('p', { class: 'empty' }, 'No beers listed here yet.')
          : [h('p', { class: 'sheet-hint' }, 'Here now? Tap 👍 if a beer is still on, or 👎 if it has gone.'), groups],
        h(
          'div',
          { class: 'sheet-actions' },
          h('button', { type: 'button', class: 'button', onclick: comingSoon('Sending photos') }, 'Send a photo of the taps'),
          h('button', { type: 'button', class: 'button', onclick: comingSoon('Suggesting beers') }, 'Suggest a beer'),
          h('p', { class: 'sheet-notice', role: 'status' }),
        ),
      ),
    );
  }

  return {
    open(pubId: string, now: number) {
      const pub = o.catalogue.pub(pubId);
      if (!pub) return false;
      if (currentPubId !== pubId) render(pub, now);
      currentPubId = pubId;
      if (!o.dialog.open) {
        o.dialog.showModal();
        o.dialog.scrollTop = 0;
        o.dialog.querySelector<HTMLElement>('.sheet-close')?.focus();
      }
      return true;
    },

    close() {
      if (o.dialog.open) o.dialog.close();
    },

    /** Updates the distance after the user's location changes. */
    refreshDistance() {
      const pub = currentPubId ? o.catalogue.pub(currentPubId) : undefined;
      const el = o.dialog.querySelector('.sheet-distance');
      if (pub && el) el.textContent = distanceText(pub);
    },

    /** Re-draws one beer after a vote and moves focus to its "Thanks" or message. */
    refreshListing(listingId: number, now: number, { focus = true } = {}) {
      const listing = o.catalogue.listing(listingId);
      const old = o.dialog.querySelector(`[data-listing="${listingId}"]`);
      const fresh = listing && tapRow(listing, now);
      if (!old || !fresh) return;
      const hadFocus = old.contains(document.activeElement);
      old.replaceWith(fresh);
      if (focus || hadFocus) fresh.querySelector<HTMLElement>('[data-vote-status]')?.focus();
    },
  };
}
