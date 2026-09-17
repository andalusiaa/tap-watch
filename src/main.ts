import { createCatalogue, type Catalogue, type DispenseFilter } from './catalogue';
import { SNAPSHOT_URL } from './config';
import { applyVote, type VoteDirection } from './rules';
import type { Snapshot } from './types';
import { setupAutocomplete } from './ui/autocomplete';
import { byId, h } from './ui/dom';
import { setupLocationBar } from './ui/locationBar';
import { setupPubSheet } from './ui/pubSheet';
import { renderResults, type ResultsMode } from './ui/results';

// --- State, kept in the URL so links and the back button work ------------------

interface State {
  beerId: string | null;
  noMatch: string | null;
  dispense: DispenseFilter;
  pubId: string | null;
}

function stateFromUrl(): State {
  const p = new URLSearchParams(location.search);
  const dispense = p.get('dispense');
  return {
    beerId: p.get('beer'),
    noMatch: null,
    dispense: dispense === 'cask' || dispense === 'keg' ? dispense : 'any',
    pubId: p.get('pub'),
  };
}

function urlFor(s: State): string {
  const p = new URLSearchParams();
  if (s.beerId) p.set('beer', s.beerId);
  if (s.dispense !== 'any') p.set('dispense', s.dispense);
  if (s.pubId) p.set('pub', s.pubId);
  const query = p.toString();
  return query ? `?${query}` : location.pathname;
}

// --- Elements ------------------------------------------------------------------

const els = {
  banner: byId('sample-banner'),
  form: byId<HTMLFormElement>('search-form'),
  input: byId<HTMLInputElement>('beer-search'),
  listbox: byId<HTMLUListElement>('beer-options'),
  dispense: byId<HTMLFieldSetElement>('dispense'),
  heading: byId('results-heading'),
  clear: byId<HTMLButtonElement>('results-clear'),
  summary: byId('results-summary'),
  results: byId('results'),
  status: byId('app-status'),
  sheet: byId<HTMLDialogElement>('pub-sheet'),
};

async function loadSnapshot(): Promise<Snapshot> {
  const res = await fetch(SNAPSHOT_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Snapshot request failed: ${res.status}`);
  return res.json();
}

function start(catalogue: Catalogue) {
  let state = stateFromUrl();
  const votedThisVisit = new Set<number>();

  els.banner.hidden = !catalogue.sample;

  function setState(patch: Partial<State>, how: 'push' | 'replace') {
    state = { ...state, ...patch };
    const url = urlFor(state);
    if (how === 'push') history.pushState({ sheet: Boolean(patch.pubId) }, '', url);
    else history.replaceState(history.state, '', url);
    render();
  }

  const autocomplete = setupAutocomplete({
    input: els.input,
    listbox: els.listbox,
    form: els.form,
    catalogue,
    onSelect: (beer) => {
      locationBar.onSearch();
      setState({ beerId: beer.id, noMatch: null, pubId: null }, 'push');
    },
    onNoMatch: (query) => setState({ beerId: null, noMatch: query, pubId: null }, 'replace'),
    onClear: () => {
      if (state.beerId || state.noMatch) setState({ beerId: null, noMatch: null }, 'replace');
    },
  });

  const sheet = setupPubSheet({
    dialog: els.sheet,
    catalogue,
    origin: () => locationBar.origin(),
    hasVoted: (id) => votedThisVisit.has(id),
    onVote: (listingId, direction) => vote(listingId, direction),
    onClose: () => {
      if (!state.pubId) return;
      // Opening the sheet added a history entry; going back removes it.
      if (history.state?.sheet) history.back();
      else setState({ pubId: null }, 'replace');
    },
  });

  const locationBar = setupLocationBar({
    areaName: catalogue.area.name,
    areaCentre: catalogue.area.centre,
    onChange: () => {
      renderList();
      sheet.refreshDistance();
    },
  });

  function vote(listingId: number, direction: VoteDirection) {
    const listing = catalogue.listing(listingId);
    if (!listing) return;
    // Phase 1: votes only change this page. Phase 2 sends them to the server.
    const { status, ...times } = applyVote(listing, direction, { now: new Date().toISOString(), fromDifferentDevice: false });
    if (status !== 'removed') Object.assign(listing, { status, ...times });
    votedThisVisit.add(listingId);
    sheet.refreshListing(listingId, Date.now());
    renderList();
  }

  function currentMode(): ResultsMode {
    const beer = state.beerId ? catalogue.beer(state.beerId) : undefined;
    if (beer) return { kind: 'beer', beer };
    if (state.noMatch) return { kind: 'no-match', query: state.noMatch };
    return { kind: 'browse' };
  }

  function renderList() {
    const mode = currentMode();
    const view = renderResults(mode, {
      catalogue,
      origin: locationBar.origin(),
      dispense: state.dispense,
      now: Date.now(),
      openPub: (pubId) => setState({ pubId }, 'push'),
      onAddBeer: () => {
        els.status.textContent = 'Adding beers is coming soon. For now, this is a prototype.';
      },
    });
    els.heading.replaceChildren(h('span', null, view.heading));
    els.summary.textContent = view.summary;
    els.results.replaceChildren(...view.items);
    els.clear.hidden = mode.kind === 'browse';
  }

  function render() {
    const beer = state.beerId ? catalogue.beer(state.beerId) : undefined;
    if (beer && document.activeElement !== els.input) autocomplete.setValue(beer.name);
    if (!beer && !state.noMatch && document.activeElement !== els.input) autocomplete.setValue('');

    for (const input of els.dispense.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = input.value === state.dispense;
    }
    els.status.textContent = '';
    renderList();

    if (state.pubId) {
      if (!sheet.open(state.pubId, Date.now())) setState({ pubId: null }, 'replace');
    } else {
      sheet.close();
    }
  }

  // --- Controls ------------------------------------------------------------------

  els.dispense.addEventListener('change', (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (value === 'any' || value === 'cask' || value === 'keg') setState({ dispense: value }, 'replace');
  });

  els.clear.addEventListener('click', () => {
    setState({ beerId: null, noMatch: null, pubId: null }, 'push');
    els.input.focus();
  });

  window.addEventListener('popstate', () => {
    state = stateFromUrl();
    render();
  });

  render();
}

loadSnapshot()
  .then((snapshot) => start(createCatalogue(snapshot)))
  .catch((error: unknown) => {
    console.error(error);
    byId('results').replaceChildren(
      h('li', { class: 'empty' }, h('p', null, "Sorry, the beer list didn't load. Check your connection and refresh the page.")),
    );
  });
