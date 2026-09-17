// Lookups and queries over one area snapshot.

import { freshnessRank } from './freshness';
import { distanceKm, type LatLng } from './geo';
import { buildBeerIndex } from './search';
import type { Beer, Dispense, Listing, Operator, Pub, Snapshot } from './types';

export type DispenseFilter = Dispense | 'any';

export interface PubResult {
  pub: Pub;
  km: number;
  listings: Listing[];
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

const matchesDispense = (l: Listing, dispense: DispenseFilter) => dispense === 'any' || l.dispense === dispense;
const isAvailable = (l: Listing) => l.status !== 'reported_gone';

export function createCatalogue(snapshot: Snapshot) {
  const pubById = new Map(snapshot.pubs.map((p) => [p.id, p]));
  const beerById = new Map(snapshot.beers.map((b) => [b.id, b]));
  const operatorById = new Map(snapshot.operators.map((o) => [o.id, o]));
  const listingById = new Map(snapshot.listings.map((l) => [l.id, l]));
  const listingsByPub = groupBy(snapshot.listings, (l) => l.pub_id);
  const listingsByBeer = groupBy(snapshot.listings, (l) => l.beer_id);
  const beerIndex = buildBeerIndex(snapshot.beers);

  /** Number of pubs where a beer is listed and not reported gone. */
  function pubCount(beer: Beer): number {
    const listings = listingsByBeer.get(beer.id) ?? [];
    return new Set(listings.filter(isAvailable).map((l) => l.pub_id)).size;
  }

  /** Nearest first; within ~10 m, the fresher listing first. */
  function sortResults(results: PubResult[], now: number): PubResult[] {
    const best = (r: PubResult) => Math.min(...r.listings.map((l) => freshnessRank(l, now)));
    return results.sort((a, b) => Math.round(a.km * 100) - Math.round(b.km * 100) || best(a) - best(b));
  }

  function toResults(listings: Listing[], origin: LatLng, now: number): PubResult[] {
    const results: PubResult[] = [];
    for (const [pubId, pubListings] of groupBy(listings, (l) => l.pub_id)) {
      const pub = pubById.get(pubId);
      if (!pub) continue;
      results.push({ pub, km: distanceKm(origin, [pub.lat, pub.lng]), listings: pubListings });
    }
    return sortResults(results, now);
  }

  return {
    area: snapshot.area,
    sample: snapshot.sample,

    beer: (id: string): Beer | undefined => beerById.get(id),
    pub: (id: string): Pub | undefined => pubById.get(id),
    operator: (id: string | null): Operator | undefined => (id ? operatorById.get(id) : undefined),
    listing: (id: number): Listing | undefined => listingById.get(id),
    listingsAt: (pubId: string): Listing[] => listingsByPub.get(pubId) ?? [],
    pubCount,

    searchBeers(query: string, alcoholFreeOnly: boolean, limit: number): Beer[] {
      return beerIndex.search(query, { alcoholFreeOnly, limit, popularity: pubCount });
    },

    /** Pubs listing a beer, split into those that have it and those where it was reported gone. */
    pubsForBeer(beerId: string, origin: LatLng, dispense: DispenseFilter, now: number) {
      const listings = (listingsByBeer.get(beerId) ?? []).filter((l) => matchesDispense(l, dispense));
      const available = toResults(listings.filter(isAvailable), origin, now);
      const availablePubs = new Set(available.map((r) => r.pub.id));
      const gone = toResults(
        listings.filter((l) => !isAvailable(l) && !availablePubs.has(l.pub_id)),
        origin,
        now,
      );
      return { available, gone };
    },

    /** Pubs with at least one alcohol-free beer on tap, listing just those beers. */
    pubsWithAlcoholFree(origin: LatLng, dispense: DispenseFilter, now: number): PubResult[] {
      const listings = snapshot.listings.filter(
        (l) => isAvailable(l) && matchesDispense(l, dispense) && beerById.get(l.beer_id)?.af,
      );
      return toResults(listings, origin, now);
    },

    /** Every pub, with the listings that match the dispense filter. */
    allPubs(origin: LatLng, dispense: DispenseFilter, now: number): PubResult[] {
      const results = snapshot.pubs.map((pub) => ({
        pub,
        km: distanceKm(origin, [pub.lat, pub.lng]),
        listings: (listingsByPub.get(pub.id) ?? []).filter((l) => isAvailable(l) && matchesDispense(l, dispense)),
      }));
      return sortResults(
        dispense === 'any' ? results : results.filter((r) => r.listings.length > 0),
        now,
      );
    },
  };
}

export type Catalogue = ReturnType<typeof createCatalogue>;
