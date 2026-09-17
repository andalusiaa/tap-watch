-- Photo reports and beer suggestions, both checked by the admin (SPEC sections 6.4-6.6).

CREATE TABLE photo_reports (
  id INTEGER PRIMARY KEY,
  pub_id TEXT NOT NULL REFERENCES pubs (id) ON DELETE CASCADE,
  -- Key of the photo in the PHOTOS store; NULL once the photo is deleted.
  photo_key TEXT,
  photo_bytes INTEGER,
  note TEXT CHECK (note IS NULL OR length(note) <= 280),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  device_hash TEXT,                          -- cleared after 30 days
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX photo_reports_status ON photo_reports (status, created_at);
CREATE INDEX photo_reports_hashed_created ON photo_reports (created_at) WHERE device_hash IS NOT NULL;

CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY,
  pub_id TEXT REFERENCES pubs (id) ON DELETE CASCADE,
  -- A beer from the master list, or a proposed new one.
  beer_id TEXT REFERENCES beers (id) ON DELETE CASCADE,
  proposed_beer_name TEXT CHECK (proposed_beer_name IS NULL OR length(proposed_beer_name) <= 80),
  dispense TEXT CHECK (dispense IS NULL OR dispense IN ('cask', 'keg')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  device_hash TEXT,                          -- cleared after 30 days
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  CHECK (beer_id IS NOT NULL OR proposed_beer_name IS NOT NULL)
);
CREATE INDEX suggestions_status ON suggestions (status, created_at);
CREATE INDEX suggestions_hashed_created ON suggestions (created_at) WHERE device_hash IS NOT NULL;
