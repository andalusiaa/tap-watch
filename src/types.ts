// Shape of the area snapshot: /data/snapshot-<area>.json now, /api/snapshot in Phase 2.

export type Category = 'lager' | 'stout' | 'pale_ipa' | 'bitter_cask' | 'cider' | 'other';
export type Dispense = 'cask' | 'keg';
/** Statuses the public can see. 'removed' listings are never sent to the browser. */
export type ListingStatus = 'likely' | 'confirmed' | 'reported_gone';

export interface Area {
  id: string;
  name: string;
  postcode_district: string;
  borough: string;
  /** [lat, lng] */
  centre: [number, number];
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
}

export interface Operator {
  id: string;
  name: string;
  type: 'pubco' | 'brewery' | 'independent';
}

export interface Pub {
  id: string;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  operator_id: string | null;
  venue_type: 'pub' | 'bar';
}

export interface Beer {
  id: string;
  name: string;
  brewery: string | null;
  category: Category;
  abv: number | null;
  /** Alcohol-free: ABV 0.5% or lower. */
  af: boolean;
  aliases: string[];
}

export interface Listing {
  id: number;
  pub_id: string;
  beer_id: string;
  dispense: Dispense;
  status: ListingStatus;
  last_confirmed_at: string | null;
  reported_gone_at: string | null;
}

export interface Snapshot {
  version: 1;
  generated_at: string;
  /** True while the tap lists are made-up prototype data. */
  sample: boolean;
  area: Area;
  operators: Operator[];
  pubs: Pub[];
  beers: Beer[];
  listings: Listing[];
}
