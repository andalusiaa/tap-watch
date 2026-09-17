-- Tap Watch: initial schema (SPEC section 7).
-- Timestamps are ISO 8601 UTC text. Every column used to look rows up has an index,
-- because the D1 free plan counts every row a query reads.
-- Photo reports and suggestions arrive in a later migration (Phase 4).

CREATE TABLE areas (
  id TEXT PRIMARY KEY,                       -- 'e17'
  name TEXT NOT NULL,                        -- 'Walthamstow'
  postcode_district TEXT NOT NULL,           -- 'E17'
  borough TEXT NOT NULL,                     -- 'Waltham Forest'
  centre_lat REAL NOT NULL,
  centre_lng REAL NOT NULL,
  bbox TEXT NOT NULL,                        -- JSON [minLng, minLat, maxLng, maxLat]
  -- 1 while the tap lists are made-up test data; the site shows a banner.
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1))
);

CREATE TABLE operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pubco', 'brewery', 'independent'))
);

CREATE TABLE beers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brewery TEXT,
  category TEXT NOT NULL CHECK (category IN ('lager', 'stout', 'pale_ipa', 'bitter_cask', 'cider', 'other')),
  abv REAL CHECK (abv IS NULL OR (abv >= 0 AND abv <= 15)),
  is_alcohol_free INTEGER NOT NULL DEFAULT 0 CHECK (is_alcohol_free IN (0, 1)),
  is_regular INTEGER NOT NULL DEFAULT 1 CHECK (is_regular IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE beer_aliases (
  alias TEXT PRIMARY KEY,                    -- normalised: lowercase, no accents or apostrophes
  beer_id TEXT NOT NULL REFERENCES beers (id) ON DELETE CASCADE
);
CREATE INDEX beer_aliases_beer ON beer_aliases (beer_id);

CREATE TABLE operator_core_range (
  operator_id TEXT NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
  beer_id TEXT NOT NULL REFERENCES beers (id) ON DELETE CASCADE,
  dispense TEXT NOT NULL CHECK (dispense IN ('cask', 'keg')),
  PRIMARY KEY (operator_id, beer_id, dispense)
);
CREATE INDEX operator_core_range_beer ON operator_core_range (beer_id);

CREATE TABLE pubs (
  id TEXT PRIMARY KEY,                       -- 'the-chequers-e17'
  osm_id TEXT UNIQUE,
  area_id TEXT NOT NULL REFERENCES areas (id),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  venue_type TEXT NOT NULL DEFAULT 'pub' CHECK (venue_type IN ('pub', 'bar')),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  operator_id TEXT REFERENCES operators (id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX pubs_area ON pubs (area_id, is_active);
CREATE INDEX pubs_operator ON pubs (operator_id);

-- One beer at one pub, one way of serving it. Draught only: cask or keg.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  pub_id TEXT NOT NULL REFERENCES pubs (id) ON DELETE CASCADE,
  beer_id TEXT NOT NULL REFERENCES beers (id) ON DELETE CASCADE,
  dispense TEXT NOT NULL CHECK (dispense IN ('cask', 'keg')),
  status TEXT NOT NULL CHECK (status IN ('likely', 'confirmed', 'reported_gone', 'removed')),
  source TEXT NOT NULL CHECK (source IN ('template', 'vote', 'photo', 'admin', 'suggestion')),
  last_confirmed_at TEXT,
  reported_gone_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (pub_id, beer_id, dispense)
);
CREATE INDEX listings_beer ON listings (beer_id);

CREATE TABLE votes (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  direction INTEGER NOT NULL CHECK (direction IN (1, -1)),
  device_hash TEXT,                          -- cleared after 30 days (SPEC section 9)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX votes_listing_device ON votes (listing_id, device_hash, created_at);
-- Lets the daily clean-up find only the votes that still hold a device hash.
CREATE INDEX votes_hashed_created ON votes (created_at) WHERE device_hash IS NOT NULL;

-- Counters for rate limits and the daily write cap. Rows are deleted once expired.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,                      -- e.g. 'vote-hour:<device_hash>:2026-09-17T14'
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX rate_limits_expires ON rate_limits (expires_at);

-- The public snapshot, built once and reused, so most page loads read one row.
-- Every change bumps version; the cached json is stale while built_version < version.
CREATE TABLE snapshot_cache (
  area_id TEXT PRIMARY KEY REFERENCES areas (id) ON DELETE CASCADE,
  json TEXT,
  built_at TEXT,
  built_version INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1
);

-- Random salt mixed into device hashes. A new one replaces the old every 30 days,
-- so hashes can't be linked across months.
CREATE TABLE device_salts (
  id INTEGER PRIMARY KEY,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
