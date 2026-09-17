// Small labelled pieces used in the results list and the pub sheet.

import { freshnessOf } from '../freshness';
import type { Beer, Dispense, Listing } from '../types';
import { h } from './dom';

export function freshnessBadge(listing: Listing, now: number): HTMLElement {
  const { state, label } = freshnessOf(listing, now);
  return h('span', { class: `badge badge--${state}` }, label);
}

export function dispenseLabel(dispense: Dispense): HTMLElement {
  return h('span', { class: 'dispense' }, dispense === 'cask' ? 'Cask' : 'Keg');
}

export function alcoholFreeLabel(beer: Beer): HTMLElement | null {
  if (!beer.af) return null;
  const text = beer.abv != null && beer.abv > 0 ? `Alcohol-free · ${beer.abv}%` : 'Alcohol-free · 0.0%';
  return h('span', { class: 'af-label' }, text);
}

/** A visible dot that screen readers hear as a comma. */
export const separator = () =>
  h('span', { class: 'sep' }, h('span', { 'aria-hidden': 'true' }, '·'), h('span', { class: 'visually-hidden' }, ', '));
