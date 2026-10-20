import { loadSnapshot, sendVote } from './api';
import { createCatalogue, type Catalogue, type DispenseFilter } from './catalogue';
import { applyVote, type VoteDirection } from './rules';
import { mapPoints } from './mapPoints';
import { voteMemory } from './voteMemory';
import { AGEING_MAX_DAYS, FRESH_MAX_DAYS } from './config';
import { periodName } from './freshness';
import type { PubMap } from './ui/map';
import { setupAutocomplete } from './ui/autocomplete';
import { byId, h } from './ui/dom';
import { setupLocationBar } from './ui/locationBar';
import { setupPubSheet } from './ui/pubSheet';
import { exampleBeers, typedPlaceholder } from './ui/typedPlaceholder';
import { suggestForm } from './ui/forms';
import { renderResults, type ResultsMode } from './ui/results';

// --- State, kept in the URL so links and the back button work ------------------

interface State {
  beerId: string | null;
  noMatch: string | null;
  dispense: DispenseFilter;
  /** Only pubs with an alcohol-free beer on. */
  alcoholFree: boolean;
  view: 'list' | 'map';
  pubId: string | null;
}

function stateFromUrl(): State {
  const p = new URLSearchParams(location.search);
  const dispense = p.get('dispense');
  return {
    beerId: p.get('beer'),
    noMatch: null,
    dispense: dispense === 'cask' || dispense === 'keg' ? dispense : 'any',
    alcoholFree: p.get('af') === '1',
    view: p.get('view') === 'map' ? 'map' : 'list',
    pubId: p.get('pub'),
  };
}

function urlFor(s: State): string {
  const p = new URLSearchParams();
  if (s.beerId) p.set('beer', s.beerId);
  if (s.dispense !== 'any') p.set('dispense', s.dispense);
  if (s.alcoholFree) p.set('af', '1');
  if (s.view === 'map') p.set('view', 'map');
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
  alcoholFree: byId<HTMLInputElement>('af-only'),
  pill: byId<HTMLButtonElement>('search-pill'),
  pillMain: byId('search-pill-main'),
  pillSub: byId('search-pill-sub'),
  panel: byId('search-panel'),
  searchDone: byId<HTMLButtonElement>('search-done'),
  mapToggle: byId<HTMLButtonElement>('map-toggle'),
  mapToggleLabel: byId('map-toggle-label'),
  mapView: byId('map-view'),
  map: byId('map'),
  mapStatus: byId('map-status'),
  mapLegend: byId('map-legend'),
  mapHint: byId('map-hint'),
  heading: byId('results-heading'),
  clear: byId<HTMLButtonElement>('results-clear'),
  searchClear: byId<HTMLButtonElement>('search-clear'),
  summary: byId('results-summary'),
  results: byId('results'),
  status: byId('app-status'),
  sheet: byId<HTMLDialogElement>('pub-sheet'),
  honeypot: byId<HTMLInputElement>('website'),
};

/** Map key wording, from the thresholds in config.ts. */
function fillLegend() {
  const text: Record<string, string> = {
    fresh: `Checked in the last ${periodName(FRESH_MAX_DAYS).replace(/^1 /, '')}`,
    ageing:
      FRESH_MAX_DAYS % 30 === 0 && AGEING_MAX_DAYS % 30 === 0
        ? `Checked ${FRESH_MAX_DAYS / 30} to ${periodName(AGEING_MAX_DAYS)} ago`
        : `Checked ${periodName(FRESH_MAX_DAYS)} to ${periodName(AGEING_MAX_DAYS)} ago`,
    stale: `Checked over ${periodName(AGEING_MAX_DAYS)} ago`,
  };
  for (const el of document.querySelectorAll<HTMLElement>('[data-legend]')) {
    el.textContent = text[el.dataset.legend ?? ''] ?? el.textContent;
  }
}

function start(catalogue: Catalogue) {
  fillLegend();
  let state = stateFromUrl();
  /** Messages shown next to a beer's vote buttons, by listing id. */
  const voteNotes = new Map<number, string>();

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
      // The beer is chosen: fold the filters away so the results have the screen.
      showPanel(false, false);
    },
    onNoMatch: (query) => setState({ beerId: null, noMatch: query, pubId: null }, 'replace'),
    onClear: () => {
      if (state.beerId || state.noMatch) setState({ beerId: null, noMatch: null }, 'replace');
    },
  });

  // Examples in the search box, typed out one at a time, from beers people can actually find.
  const examples = exampleBeers(
    catalogue.beers().filter((b) => catalogue.pubCount(b) > 0),
    8,
  );
  typedPlaceholder({
    input: els.input,
    names: examples.length ? examples : exampleBeers(catalogue.beers(), 8),
    active: () => !els.panel.hasAttribute('hidden'),
  });

  const sheet = setupPubSheet({
    dialog: els.sheet,
    catalogue,
    origin: () => locationBar.origin(),
    hasVoted: (id) => voteMemory.hasVoted(id),
    voteNote: (id) => voteNotes.get(id),
    onVote: (listingId, direction) => void vote(listingId, direction),
    honeypot: () => els.honeypot.value,
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
      updatePill();
      renderList();
      sheet.refreshDistance();
      updateMapYou();
    },
  });

  // --- Map (loaded on first use) ---------------------------------------------------

  let pubMap: PubMap | null = null;
  let mapLoading = false;
  let lastFitKey = '';

  function updateMapYou() {
    if (!pubMap) return;
    const where = locationBar.current();
    pubMap.showYou(where.kind === 'area' ? null : { point: where.point, accuracy: where.accuracy });
    if (where.settled && where.kind !== 'area') lastFitKey = ''; // refit to include the new position
    updateMapPubs();
  }

  function updateMapPubs() {
    if (!pubMap) return;
    const mode = currentMode();
    const fitKey = `${mode.kind === 'beer' ? mode.beer.id : mode.kind}|${state.dispense}|${state.alcoholFree}`;
    const points = mapPoints(mode, catalogue, locationBar.origin(), state.dispense, Date.now(), state.alcoholFree);
    pubMap.showPubs(points, { fit: fitKey !== lastFitKey });
    lastFitKey = fitKey;
    els.mapLegend.hidden = mode.kind !== 'beer';
    els.mapHint.textContent =
      mode.kind === 'beer'
        ? points.length ? 'Tap a pin to see the pub.' : ''
        : 'Tap a pin to see the pub. Choose a beer to see how recently each pub was checked.';
  }

  function showMap() {
    if (pubMap) {
      pubMap.resize();
      updateMapPubs();
      return;
    }
    if (mapLoading) return;
    mapLoading = true;
    els.mapStatus.textContent = 'Loading the map…';
    import('./ui/map')
      .then(({ createPubMap }) =>
        createPubMap(els.map, {
          areaId: catalogue.area.id,
          onPubClick: (pubId) => setState({ pubId }, 'push'),
        }),
      )
      .then((created) => {
        pubMap = created;
        els.mapStatus.textContent = '';
        updateMapYou();
      })
      .catch((error: unknown) => {
        console.error(error);
        els.mapStatus.textContent = "The map couldn't load. Check your connection, or switch to the list.";
      })
      .finally(() => {
        mapLoading = false;
      });
  }

  async function vote(listingId: number, direction: VoteDirection) {
    const listing = catalogue.listing(listingId);
    if (!listing || voteMemory.hasVoted(listingId)) return;

    // Show the result straight away; undo it if the server says no.
    const before = { ...listing };
    const { status, ...times } = applyVote(listing, direction, { now: new Date().toISOString(), fromDifferentDevice: false });
    if (status !== 'removed') Object.assign(listing, { status, ...times });
    voteMemory.remember(listingId);
    voteNotes.delete(listingId);
    sheet.refreshListing(listingId, Date.now());
    renderList();

    const result = await sendVote(listingId, direction, els.honeypot.value);
    if (result.ok) {
      if (result.listing) {
        catalogue.applyServerListing(result.listing);
        voteMemory.remember(listingId, result.listing);
      }
    } else {
      Object.assign(listing, before);
      // Already voted today (perhaps on another visit): keep the buttons off.
      if (result.error !== 'already_voted') voteMemory.forget(listingId);
      voteNotes.set(listingId, result.message);
    }
    sheet.refreshListing(listingId, Date.now(), { focus: false });
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
      alcoholFree: state.alcoholFree,
      now: Date.now(),
      openPub: (pubId) => setState({ pubId }, 'push'),
      suggestForm: (beerName) => suggestForm({ catalogue, beerName, honeypot: () => els.honeypot.value }),
    });
    els.heading.replaceChildren(h('span', null, view.heading));
    els.summary.textContent = view.summary;
    els.results.replaceChildren(...view.items);
    els.clear.hidden = mode.kind === 'browse';
    const onMap = state.view === 'map';
    els.results.hidden = onMap;
    els.mapView.hidden = !onMap;
    if (onMap) showMap();
  }

  /** Opens or closes the filter panel. The pill shows what's set while it's closed. */
  function showPanel(open: boolean, focusInput = true) {
    els.panel.hidden = !open;
    els.pill.setAttribute('aria-expanded', String(open));
    if (open && focusInput) els.input.focus();
    if (!open) updatePill();
  }

  const DISPENSE_WORD: Record<DispenseFilter, string> = { any: 'Cask or keg', cask: 'Cask', keg: 'Keg' };

  function updatePill() {
    const beer = state.beerId ? catalogue.beer(state.beerId) : undefined;
    const typed = els.input.value.trim();
    els.pillMain.textContent = beer?.name ?? (state.noMatch ?? (typed || 'Which beer?'));
    els.pillMain.classList.toggle('search-pill-main--empty', !beer && !state.noMatch && !typed);
    els.pillSub.textContent = [DISPENSE_WORD[state.dispense], state.alcoholFree ? 'Alcohol-free' : null, locationBar.summary()]
      .filter(Boolean)
      .join(' · ');
  }

  function render() {
    const beer = state.beerId ? catalogue.beer(state.beerId) : undefined;
    if (beer && document.activeElement !== els.input) autocomplete.setValue(beer.name);
    if (!beer && !state.noMatch && document.activeElement !== els.input) autocomplete.setValue('');
    updateSearchClear();

    for (const input of els.dispense.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = input.value === state.dispense;
    }
    els.alcoholFree.checked = state.alcoholFree;
    const onMapView = state.view === 'map';
    els.mapToggleLabel.textContent = onMapView ? 'List' : 'Map';
    els.mapToggle.setAttribute('aria-label', onMapView ? 'Show the pubs as a list' : 'Show the pubs on a map');
    for (const [i, icon] of [...els.mapToggle.querySelectorAll<SVGElement>('.map-fab-icon')].entries()) {
      icon.toggleAttribute('hidden', onMapView ? i === 0 : i === 1);
    }
    updatePill();
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

  els.alcoholFree.addEventListener('change', () => setState({ alcoholFree: els.alcoholFree.checked }, 'replace'));

  els.mapToggle.addEventListener('click', () => {
    showPanel(false);
    setState({ view: state.view === 'map' ? 'list' : 'map' }, 'replace');
    if (state.view === 'list') els.results.scrollIntoView({ block: 'nearest' });
  });

  els.pill.addEventListener('click', () => showPanel(els.panel.hasAttribute('hidden')));
  els.searchDone.addEventListener('click', () => {
    showPanel(false);
    els.pill.focus();
  });
  els.panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || els.panel.hidden) return;
    e.preventDefault();
    showPanel(false);
    els.pill.focus();
  });

  function updateSearchClear() {
    els.searchClear.hidden = els.input.value === '' && !state.beerId && !state.noMatch;
  }
  els.input.addEventListener('input', () => {
    updateSearchClear();
    updatePill();
  });

  els.searchClear.addEventListener('click', () => {
    autocomplete.setValue('');
    els.input.focus();
    if (state.beerId || state.noMatch || state.pubId) setState({ beerId: null, noMatch: null, pubId: null }, 'push');
    updateSearchClear();
  });

  els.clear.addEventListener('click', () => {
    setState({ beerId: null, noMatch: null, pubId: null }, 'push');
    // Only move focus into the panel if it's open; otherwise stay on the pill.
    if (els.panel.hasAttribute('hidden')) els.pill.focus();
    else els.input.focus();
  });

  window.addEventListener('popstate', () => {
    state = stateFromUrl();
    render();
  });

  render();
}

// --- Colours (public/theme.js does the work) --------------------------------------

declare global {
  interface Window {
    tapWatchTheme?: { choice(): 'auto' | 'light' | 'dark'; set(mode: 'auto' | 'light' | 'dark'): void };
  }
}

const themeChoice = document.getElementById('theme-choice');
if (themeChoice && window.tapWatchTheme) {
  const current = window.tapWatchTheme.choice();
  for (const input of themeChoice.querySelectorAll<HTMLInputElement>('input')) input.checked = input.value === current;
  themeChoice.addEventListener('change', (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (value === 'auto' || value === 'light' || value === 'dark') window.tapWatchTheme?.set(value);
  });
}

loadSnapshot()
  .then((snapshot) => {
    const catalogue = createCatalogue(snapshot);
    // Votes from this device that the shared snapshot may not include yet.
    for (const listing of voteMemory.newerThan(snapshot.generated_at)) catalogue.applyServerListing(listing);
    start(catalogue);
  })
  .catch((error: unknown) => {
    console.error(error);
    byId('results').replaceChildren(
      h('li', { class: 'empty' }, h('p', null, "Sorry, the beer list didn't load. Check your connection and refresh the page.")),
    );
  });
