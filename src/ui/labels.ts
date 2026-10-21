// Small labelled pieces used in the results list and the pub sheet.

import { freshnessOf } from '../freshness';
import type { Beer, Dispense, Listing } from '../types';
import { h } from './dom';

/** Initials for a brewery monogram: "Camden Town" → "CT", "BrewDog" → "BD", "Guinness" → "G". */
export function initials(name: string): string {
  const words = name.replace(/^The /i, '').split(/[\s-]+/).filter((w) => /[a-z0-9]/i.test(w));
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/**
 * A small square beside a beer: the brewery's logo where we have one, otherwise its initials.
 * Decorative only, because the brewery name is in the text next to it.
 */
export function breweryMark(brewery: { id: string; name: string; logo?: 'svg' | 'png' } | undefined): HTMLElement {
  if (!brewery) return h('span', { class: 'mark mark--empty', 'aria-hidden': 'true' });
  if (brewery.logo) {
    return h('img', {
      class: 'mark mark--logo',
      src: `/breweries/${brewery.id}.${brewery.logo}`,
      alt: '',
      width: '32',
      height: '32',
      loading: 'lazy',
      decoding: 'async',
    });
  }
  return h('span', { class: 'mark', 'aria-hidden': 'true', title: brewery.name }, initials(brewery.name));
}

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
