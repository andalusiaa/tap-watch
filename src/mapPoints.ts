// Which pubs to pin on the map, and what colour, for the current search.

import type { Catalogue, DispenseFilter } from './catalogue';
import { freshnessOf, freshnessRank } from './freshness';
import type { LatLng } from './geo';
import type { Listing } from './types';
import type { PubPoint } from './ui/map';
import type { ResultsMode } from './ui/results';

function freshest(listings: Listing[], now: number): Listing | undefined {
  return [...listings].sort((a, b) => freshnessRank(a, now) - freshnessRank(b, now))[0];
}

export function mapPoints(
  mode: ResultsMode,
  catalogue: Catalogue,
  origin: LatLng,
  dispense: DispenseFilter,
  now: number,
): PubPoint[] {
  switch (mode.kind) {
    case 'beer': {
      const { available, gone } = catalogue.pubsForBeer(mode.beer.id, origin, dispense, now);
      return [...available, ...gone].map(({ pub, listings }) => {
        const best = freshest(listings, now);
        return { id: pub.id, name: pub.name, lat: pub.lat, lng: pub.lng, state: best ? freshnessOf(best, now).state : 'none' };
      });
    }
    case 'browse':
      return catalogue
        .allPubs(origin, dispense, now)
        .map(({ pub }) => ({ id: pub.id, name: pub.name, lat: pub.lat, lng: pub.lng, state: 'none' as const }));
    case 'no-match':
      return [];
  }
}
