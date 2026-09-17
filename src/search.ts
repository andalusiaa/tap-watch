// Beer autocomplete. Runs entirely in the browser against the snapshot.

import type { Beer } from './types';

/** Lowercase, strip accents and punctuation. Keep in step with seed/lib/beers.mjs. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/['’]/g, '')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

interface Term {
  text: string;
  words: string[];
  weight: number;
}

interface Entry {
  beer: Beer;
  terms: Term[];
}

export interface BeerIndex {
  search(query: string, options?: { alcoholFreeOnly?: boolean; limit?: number; popularity?: (beer: Beer) => number }): Beer[];
}

function term(text: string, weight: number): Term {
  const normal = normalise(text);
  return { text: normal, words: normal.split(' '), weight };
}

function scoreTerm(query: string, queryWords: string[], t: Term): number {
  if (t.text === query) return 100 * t.weight;
  if (t.text.startsWith(query)) return 80 * t.weight;
  if (queryWords.every((q) => t.words.some((w) => w.startsWith(q)))) return 60 * t.weight;
  if (t.text.includes(query)) return 30 * t.weight;
  return 0;
}

export function buildBeerIndex(beers: Beer[]): BeerIndex {
  const entries: Entry[] = beers.map((beer) => ({
    beer,
    terms: [
      term(beer.name, 1),
      ...beer.aliases.map((a) => term(a, 0.95)),
      ...(beer.brewery ? [term(beer.brewery, 0.5)] : []),
    ],
  }));

  return {
    search(rawQuery, { alcoholFreeOnly = false, limit = Infinity, popularity = () => 0 } = {}) {
      const query = normalise(rawQuery);
      if (!query) return [];
      const queryWords = query.split(' ');

      return entries
        .filter((e) => !alcoholFreeOnly || e.beer.af)
        .map((e) => ({ beer: e.beer, score: Math.max(...e.terms.map((t) => scoreTerm(query, queryWords, t))) }))
        .filter((r) => r.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score || popularity(b.beer) - popularity(a.beer) || a.beer.name.localeCompare(b.beer.name),
        )
        .slice(0, limit)
        .map((r) => r.beer);
    },
  };
}
