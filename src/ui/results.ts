// The list of pubs under the search box, in its three modes.

import type { Catalogue, DispenseFilter, PubResult } from '../catalogue';
import { freshnessOf, freshnessRank } from '../freshness';
import { formatDistance, type LatLng } from '../geo';
import type { Beer } from '../types';
import { h, type Child } from './dom';
import { alcoholFreeLabel, dispenseLabel, freshnessBadge, separator } from './labels';

export type ResultsMode =
  | { kind: 'browse' }
  | { kind: 'alcohol-free' }
  | { kind: 'beer'; beer: Beer }
  | { kind: 'no-match'; query: string };

export interface ResultsView {
  heading: Child[];
  summary: string;
  items: HTMLElement[];
}

interface Context {
  catalogue: Catalogue;
  origin: LatLng;
  dispense: DispenseFilter;
  now: number;
  openPub: (pubId: string) => void;
  onAddBeer: () => void;
}

const plural = (n: number, one: string, many: string) => (n === 0 ? `No ${many}` : `${n} ${n === 1 ? one : many}`);
const nearestFirst = (n: number) => (n > 1 ? ', nearest first' : '');

function row(ctx: Context, result: PubResult, body: Child, extraClass = ''): HTMLElement {
  return h(
    'li',
    { class: `result ${extraClass}`.trim() },
    h(
      'button',
      { type: 'button', class: 'result-button', onclick: () => ctx.openPub(result.pub.id) },
      h(
        'span',
        { class: 'result-head' },
        h('span', { class: 'result-name' }, result.pub.name),
        h('span', { class: 'result-distance' }, formatDistance(result.km)),
      ),
      body,
    ),
  );
}

function emptyState(...lines: Child[]): HTMLElement {
  return h('li', { class: 'empty' }, lines);
}

function addLink(ctx: Context, text: string): HTMLElement {
  return h('button', { type: 'button', class: 'link-button', onclick: ctx.onAddBeer }, text);
}

const dispenseWord = (d: DispenseFilter) => (d === 'any' ? '' : `${d} `);

export function renderResults(mode: ResultsMode, ctx: Context): ResultsView {
  const areaCode = ctx.catalogue.area.postcode_district;

  switch (mode.kind) {
    case 'beer': {
      const { beer } = mode;
      const { available, gone } = ctx.catalogue.pubsForBeer(beer.id, ctx.origin, ctx.dispense, ctx.now);
      const lines = (r: PubResult) =>
        [...r.listings]
          .sort((a, b) => freshnessRank(a, ctx.now) - freshnessRank(b, ctx.now))
          .map((l) => h('span', { class: 'result-line' }, dispenseLabel(l.dispense), separator(), freshnessBadge(l, ctx.now)));

      const items = [
        ...available.map((r) => row(ctx, r, lines(r))),
        ...(gone.length ? [h('li', { class: 'result-subhead' }, h('h3', null, 'Reported gone recently'))] : []),
        ...gone.map((r) => row(ctx, r, lines(r), 'result--gone')),
      ];
      if (available.length === 0 && gone.length === 0) {
        items.push(
          emptyState(
            h('p', null, `No one's reported ${beer.name}${ctx.dispense === 'any' ? '' : ` on ${ctx.dispense}`} in ${areaCode} yet.`),
            h('p', null, 'Seen it somewhere? ', addLink(ctx, 'Add it'), '.'),
          ),
        );
      }
      return {
        heading: [h('span', { class: 'heading-beer' }, beer.name), ' ', alcoholFreeLabel(beer)],
        summary:
          available.length === 0
            ? `No pubs listed for ${beer.name}`
            : `${plural(available.length, 'pub has', 'pubs have')} ${beer.name}${ctx.dispense === 'any' ? '' : ` on ${ctx.dispense}`}${nearestFirst(available.length)}`,
        items,
      };
    }

    case 'alcohol-free': {
      const results = ctx.catalogue.pubsWithAlcoholFree(ctx.origin, ctx.dispense, ctx.now);
      const items = results.map((r) =>
        row(
          ctx,
          r,
          [...r.listings]
            .sort((a, b) => freshnessRank(a, ctx.now) - freshnessRank(b, ctx.now))
            .map((l) =>
              h(
                'span',
                { class: 'result-line' },
                h('span', { class: 'result-beer' }, ctx.catalogue.beer(l.beer_id)?.name ?? ''),
                separator(),
                dispenseLabel(l.dispense),
                separator(),
                freshnessBadge(l, ctx.now),
              ),
            ),
        ),
      );
      if (items.length === 0) {
        items.push(emptyState(h('p', null, `No one's reported an alcohol-free ${dispenseWord(ctx.dispense)}beer on tap in ${areaCode} yet.`)));
      }
      return {
        heading: ['Alcohol-free near you'],
        summary: `${plural(results.length, 'pub has', 'pubs have')} alcohol-free ${dispenseWord(ctx.dispense)}beer on tap${nearestFirst(results.length)}`,
        items,
      };
    }

    case 'no-match':
      return {
        heading: ['No match'],
        summary: `No beer called ${mode.query} in the list`,
        items: [
          emptyState(
            h('p', null, `We don't have a beer called “${mode.query}” in our list yet.`),
            h('p', null, 'Check the spelling, or ', addLink(ctx, 'add it'), '.'),
          ),
        ],
      };

    case 'browse': {
      const results = ctx.catalogue.allPubs(ctx.origin, ctx.dispense, ctx.now);
      const items = results.map((r) => {
        const freshest = [...r.listings]
          .filter((l) => l.last_confirmed_at)
          .sort((a, b) => freshnessRank(a, ctx.now) - freshnessRank(b, ctx.now))[0];
        const operator = ctx.catalogue.operator(r.pub.operator_id);
        return row(
          ctx,
          r,
          h(
            'span',
            { class: 'result-line' },
            r.listings.length === 0
              ? 'No beers listed yet'
              : plural(r.listings.length, `${dispenseWord(ctx.dispense)}beer`, `${dispenseWord(ctx.dispense)}beers`),
            freshest ? [separator(), h('span', { class: 'muted' }, freshnessOf(freshest, ctx.now).label)] : null,
            operator ? [separator(), h('span', { class: 'muted' }, operator.name)] : null,
          ),
        );
      });
      if (items.length === 0) {
        items.push(emptyState(h('p', null, `No pubs with ${ctx.dispense} beer listed yet.`)));
      }
      return {
        heading: [`Pubs in ${areaCode}`],
        summary: `${plural(results.length, 'pub', 'pubs')}${ctx.dispense === 'any' ? '' : ` with ${ctx.dispense} beer`}${nearestFirst(results.length)}`,
        items,
      };
    }
  }
}
