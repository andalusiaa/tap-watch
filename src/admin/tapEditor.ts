// Phone-friendly editor for one pub's tap list. Each beer can be marked On (checked now),
// Gone (hidden from the site, restorable) or left unchanged.

import { freshnessOf } from '../freshness';
import { normalise } from '../search';
import type { Beer, Dispense, Listing } from '../types';
import { h } from '../ui/dom';
import type { AdminListing, ListingChange } from './adminApi';

type Choice = 'on' | 'gone' | 'keep';

interface Row {
  beerId: string;
  beerName: string;
  dispense: Dispense;
  listing: AdminListing | null;
  choice: Choice;
}

let editorCount = 0;

function statusText(row: Row, now: number): string {
  const l = row.listing;
  if (!l) return 'New to this pub';
  if (l.status === 'removed') return 'Removed (hidden from the site)';
  // freshnessOf only reads the status and dates, which an admin listing has.
  return freshnessOf(l as unknown as Listing, now).label;
}

export function findBeer(beers: Beer[], typed: string): Beer | undefined {
  const wanted = normalise(typed);
  if (!wanted) return undefined;
  return beers.find((b) => normalise(b.name) === wanted || b.aliases.some((a) => normalise(a) === wanted));
}

export function beerDatalist(id: string, beers: Beer[]): HTMLDataListElement {
  return h('datalist', { id }, [...beers].sort((a, b) => a.name.localeCompare(b.name)).map((b) => h('option', { value: b.name })));
}

export function createTapEditor(o: { beers: Beer[]; listings: AdminListing[]; hint?: string }) {
  const id = `editor-${++editorCount}`;
  const now = Date.now();
  const rows: Row[] = o.listings
    .map((l) => ({ beerId: l.beer_id, beerName: l.beer_name, dispense: l.dispense, listing: l, choice: 'keep' as Choice }))
    .sort(
      (a, b) =>
        Number(a.listing?.status === 'removed') - Number(b.listing?.status === 'removed') ||
        a.beerName.localeCompare(b.beerName) ||
        a.dispense.localeCompare(b.dispense),
    );

  const list = h('ul', { class: 'edit-rows' });
  const summary = h('p', { class: 'editor-summary', 'aria-live': 'polite' });

  function updateSummary() {
    const count = rows.filter((r) => r.choice !== 'keep').length;
    summary.textContent = count === 0 ? 'No changes yet.' : `${count} ${count === 1 ? 'change' : 'changes'} to save.`;
  }

  function rowElement(row: Row, index: number): HTMLElement {
    const name = `${id}-row-${index}`;
    const removed = row.listing?.status === 'removed';
    const options: [Choice, string][] = [
      ['on', removed ? 'Restore' : 'On'],
      ['gone', 'Gone'],
      ['keep', row.listing ? 'No change' : 'Skip'],
    ];
    const group = h(
      'fieldset',
      { class: 'segmented segmented--small-row' },
      h('legend', { class: 'visually-hidden' }, `${row.beerName}, ${row.dispense}`),
      options
        .filter(([value]) => !(value === 'gone' && (removed || !row.listing)))
        .map(([value, label]) =>
          h(
            'label',
            null,
            h('input', { type: 'radio', name, value, checked: row.choice === value }),
            h('span', null, label),
          ),
        ),
    );
    group.addEventListener('change', (e) => {
      row.choice = (e.target as HTMLInputElement).value as Choice;
      updateSummary();
    });
    return h(
      'li',
      { class: removed ? 'edit-row edit-row--removed' : 'edit-row' },
      h(
        'div',
        null,
        h('span', { class: 'edit-beer' }, row.beerName),
        ' ',
        h('span', { class: 'dispense' }, row.dispense === 'cask' ? 'Cask' : 'Keg'),
        h('span', { class: 'edit-status' }, statusText(row, now)),
      ),
      group,
    );
  }

  function render() {
    list.replaceChildren(...rows.map(rowElement));
    updateSummary();
  }

  // Add a beer that isn't listed yet.
  const addInput = h('input', { id: `${id}-add`, type: 'text', list: `${id}-beers`, autocomplete: 'off' });
  const addDispense = h(
    'select',
    { id: `${id}-add-dispense` },
    h('option', { value: 'keg' }, 'Keg'),
    h('option', { value: 'cask' }, 'Cask'),
  );
  const addStatus = h('p', { class: 'form-status', role: 'status' });
  const addButton = h('button', { type: 'button', class: 'button' }, 'Add');
  addButton.addEventListener('click', () => {
    const beer = findBeer(o.beers, addInput.value);
    if (!beer) {
      addStatus.textContent = addInput.value.trim()
        ? `"${addInput.value.trim()}" isn't in the beer list. Pick one from the suggestions.`
        : 'Type a beer name first.';
      return;
    }
    const dispense = addDispense.value as Dispense;
    const existing = rows.find((r) => r.beerId === beer.id && r.dispense === dispense);
    if (existing) {
      existing.choice = 'on';
    } else {
      rows.unshift({ beerId: beer.id, beerName: beer.name, dispense, listing: null, choice: 'on' });
    }
    addInput.value = '';
    addStatus.textContent = `${beer.name} (${dispense}) marked as on.`;
    render();
  });

  const allOn = h('button', { type: 'button', class: 'button' }, 'Mark everything listed as on');
  allOn.addEventListener('click', () => {
    for (const row of rows) if (row.listing?.status !== 'removed') row.choice = 'on';
    render();
  });

  const element = h(
    'div',
    { class: 'editor' },
    o.hint ? h('p', { class: 'form-help' }, o.hint) : null,
    h('div', { class: 'editor-tools' }, allOn),
    list,
    h(
      'div',
      { class: 'add-beer' },
      h('div', null, h('label', { for: `${id}-add` }, 'Add a beer'), addInput),
      h('div', null, h('label', { for: `${id}-add-dispense` }, 'Served'), addDispense),
      addButton,
    ),
    beerDatalist(`${id}-beers`, o.beers),
    addStatus,
    summary,
  );

  render();

  return {
    element,
    changes(): ListingChange[] {
      return rows
        .filter((r) => r.choice !== 'keep')
        .map((r) => ({ beer_id: r.beerId, dispense: r.dispense, set: r.choice as 'on' | 'gone' }));
    },
  };
}
