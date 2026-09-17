// INVENTED tap lists for testing, so every freshness state can be seen.
// Deterministic: the same pubs and beers always give the same lists.

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOLS = {
  lager: { 'birra-moretti': 6, 'stella-artois': 5, 'peroni-nastro-azzurro': 5, 'madri-excepcional': 5, 'camden-hells': 5, 'estrella-damm': 3, 'san-miguel': 3, heineken: 3, pravha: 3, 'asahi-super-dry': 3, carling: 2, coors: 2, cruzcampo: 2, fosters: 1, 'carlsberg-danish-pilsner': 1, 'kronenbourg-1664': 1, 'pilsner-urquell': 1, 'meantime-london-lager': 1, 'hop-house-13': 1, 'pillars-untraditional-lager': 1 },
  pale: { 'beavertown-neck-oil': 6, 'beavertown-gamma-ray': 2, 'camden-pale-ale': 2, 'brewdog-punk-ipa': 2, 'goose-island-ipa': 1 },
  cask: { 'fullers-london-pride': 4, 'timothy-taylor-landlord': 3, 'harveys-sussex-best-bitter': 3, 'sharps-doom-bar': 3, 'greene-king-ipa': 2, 'st-austell-tribute': 2, 'adnams-ghost-ship': 2, 'dark-star-hophead': 2, 'greene-king-abbot-ale': 1, 'oakham-citra': 1, 'youngs-original': 1, 'fullers-esb': 1 },
  cider: { 'thatchers-gold': 5, 'aspall-draught-suffolk-cyder': 3, 'strongbow-dark-fruit': 2, 'thatchers-haze': 2, 'old-mout-berries-and-cherries': 1, 'westons-stowford-press': 1, 'magners-original': 1 },
  alcoholFree: { 'guinness-0-0': 5, 'lucky-saint': 4, 'heineken-0-0': 4, 'peroni-nastro-azzurro-0-0': 2, 'birra-moretti-zero': 1 },
  stout: { guinness: 9, 'murphys-irish-stout': 1 },
};

const DAY = 86_400_000;

/**
 * @param {{ id: string }[]} pubs
 * @param {{ id: string, category: string }[]} beers
 * @param {number} now
 */
export function sampleListings(pubs, beers, now) {
  const random = mulberry32(17);
  const between = (min, max) => min + Math.floor(random() * (max - min + 1));
  const daysAgo = (d) => new Date(now - d * DAY - between(0, 10) * 3_600_000).toISOString();

  const beerById = new Map(beers.map((b) => [b.id, b]));
  for (const ids of Object.values(POOLS)) {
    for (const id of Object.keys(ids)) if (!beerById.has(id)) throw new Error(`Sample pool uses unknown beer ${id}`);
  }

  /** Picks n different ids, weighted. @param {Record<string, number>} weights */
  function pickWeighted(weights, n) {
    const pool = Object.entries(weights);
    const chosen = [];
    while (chosen.length < n && pool.length) {
      const total = pool.reduce((sum, [, w]) => sum + w, 0);
      let r = random() * total;
      const index = pool.findIndex(([, w]) => (r -= w) < 0);
      chosen.push(pool.splice(index === -1 ? pool.length - 1 : index, 1)[0][0]);
    }
    return chosen;
  }

  function sampleStatus() {
    const r = random();
    if (r < 0.15) return { status: 'likely', source: 'template', last_confirmed_at: null, reported_gone_at: null };
    if (r < 0.2) {
      return { status: 'reported_gone', source: 'admin', last_confirmed_at: daysAgo(between(20, 90)), reported_gone_at: daysAgo(between(0, 6)) };
    }
    const age = r < 0.6 ? between(0, 14) : r < 0.85 ? between(15, 60) : between(61, 150);
    return { status: 'confirmed', source: 'admin', last_confirmed_at: daysAgo(age), reported_gone_at: null };
  }

  const listings = [];
  for (const pub of pubs) {
    const beerIds = [
      ...(random() < 0.9 ? pickWeighted(POOLS.stout, 1) : []),
      ...pickWeighted(POOLS.lager, between(2, 5)),
      ...pickWeighted(POOLS.pale, between(0, 2)),
      ...(random() < 0.6 ? pickWeighted(POOLS.cask, between(1, 3)) : []),
      ...pickWeighted(POOLS.cider, between(1, 2)),
      ...pickWeighted(POOLS.alcoholFree, [0, 1, 1, 2][between(0, 3)]),
    ];
    for (const beerId of beerIds) {
      listings.push({
        pub_id: pub.id,
        beer_id: beerId,
        dispense: beerById.get(beerId).category === 'bitter_cask' ? 'cask' : 'keg',
        ...sampleStatus(),
      });
    }
  }
  return listings;
}
