// Phone-friendly editor for one pub's tap list. Each beer can be marked On (checked now),
// Gone (hidden from the site, restorable), deleted for good, or left unchanged.

import { freshnessOf } from '../freshness';
import { normalise } from '../search';
import type { Beer, Dispense, Listing } from '../types';
import { h } from '../ui/dom';
import { chosenDispense, dispenseChoice } from '../ui/forms';
import type { AdminListing, ListingChange } from './adminApi';

type Choice = 'on' | 'gone' | 'delete' | 'keep';

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

/** Deleting is permanent, so check first. */
export function confirmDeletes(changes: { set: string }[]): boolean {
  const deletes = changes.filter((c) => c.set === 'delete').length;
  if (!deletes) return true;
  return confirm(
    `Delete ${deletes} beer ${deletes === 1 ? 'record' : 'records'} for good? This can't be undone. (To hide a beer for now, use Gone instead.)`,
  );
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
    const deletes = rows.filter((r) => r.choice === 'delete').length;
    summary.textContent =
      count === 0
        ? 'No changes yet.'
        : `${count} ${count === 1 ? 'change' : 'changes'} to save${deletes ? `, including ${deletes} to delete` : ''}.`;
  }

  function choose(row: Row, choice: Choice) {
    row.choice = choice;
    render();
  }

  function rowElement(row: Row, index: number): HTMLElement {
    const name = `${id}-row-${index}`;
    const removed = row.listing?.status === 'removed';
    const label = h(
      'div',
      null,
      h('span', { class: 'edit-beer' }, row.beerName),
      ' ',
      h('span', { class: 'dispense' }, row.dispense === 'cask' ? 'Cask' : 'Keg'),
    );

    if (row.choice === 'delete') {
      const undo = h('button', { type: 'button', class: 'link-button' }, 'Undo');
      undo.addEventListener('click', () => choose(row, 'keep'));
      label.append(h('span', { class: 'edit-status' }, 'Will be deleted for good when you save.'));
      return h('li', { class: 'edit-row edit-row--delete' }, label, undo);
    }

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
    label.append(h('span', { class: 'edit-status' }, statusText(row, now)));
    let remove: HTMLButtonElement | null = null;
    if (row.listing) {
      remove = h(
        'button',
        { type: 'button', class: 'link-button edit-delete', 'aria-label': `Delete the record for ${row.beerName}, ${row.dispense}` },
        'Delete record',
      );
      remove.addEventListener('click', () => choose(row, 'delete'));
    }
    return h('li', { class: removed ? 'edit-row edit-row--removed' : 'edit-row' }, label, group, remove);
  }

  function render() {
    list.replaceChildren(...rows.map(rowElement));
    updateSummary();
  }

  // Add a beer that isn't listed yet.
  const addInput = h('input', { id: `${id}-add`, type: 'text', list: `${id}-beers`, maxlength: 80, autocomplete: 'off' });
  const addDispense = dispenseChoice(`${id}-add-dispense`, `${id}-add-dispense-label`);
  const addStatus = h('p', { class: 'form-status', role: 'status' });
  const addForm = h(
    'form',
    { class: 'panel-form', 'aria-labelledby': `${id}-add-title`, novalidate: true },
    h('h3', { id: `${id}-add-title` }, 'Add a beer'),
    h('p', { class: 'form-help' }, 'Only beers served on draught, and only regulars, not one-off guest beers.'),
    h('label', { for: `${id}-add` }, 'Which beer?'),
    addInput,
    h('p', { class: 'form-label', id: `${id}-add-dispense-label` }, 'Keg or cask?'),
    addDispense,
    h('button', { type: 'submit', class: 'button button--primary' }, 'Add beer'),
    addStatus,
  );
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const beer = findBeer(o.beers, addInput.value);
    if (!beer) {
      addStatus.textContent = addInput.value.trim()
        ? `"${addInput.value.trim()}" isn't in the beer list. Pick one from the suggestions.`
        : 'Type a beer name first.';
      return;
    }
    const dispense = chosenDispense(addDispense) ?? 'keg';
    const existing = rows.find((r) => r.beerId === beer.id && r.dispense === dispense);
    if (existing) {
      existing.choice = 'on';
    } else {
      rows.unshift({ beerId: beer.id, beerName: beer.name, dispense, listing: null, choice: 'on' });
    }
    addForm.reset();
    addStatus.textContent = `${beer.name} (${dispense}) added and marked as on. Save to update the site.`;
    render();
  });

  const allOn = h('button', { type: 'button', class: 'button' }, 'Mark everything listed as on');
  allOn.addEventListener('click', () => {
    for (const row of rows) if (row.listing?.status !== 'removed' && row.choice !== 'delete') row.choice = 'on';
    render();
  });

  const element = h(
    'div',
    { class: 'editor' },
    o.hint ? h('p', { class: 'form-help' }, o.hint) : null,
    h('div', { class: 'editor-tools' }, allOn),
    list,
    summary,
    addForm,
    beerDatalist(`${id}-beers`, o.beers),
  );

  render();

  return {
    element,
    changes(): ListingChange[] {
      return rows
        .filter((r) => r.choice !== 'keep')
        .map((r) => ({ beer_id: r.beerId, dispense: r.dispense, set: r.choice as ListingChange['set'] }));
    },
  };
}
