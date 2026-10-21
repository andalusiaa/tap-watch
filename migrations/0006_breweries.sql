-- Breweries as their own records, named after the brand on the pump clip rather than the
-- group that owns it: Guinness, not Diageo; Camden Town, not Heineken. The owner is kept
-- alongside for reference. Each beer points at one brewery, which is what logos hang off.

CREATE TABLE breweries (
  id TEXT PRIMARY KEY,                       -- 'camden-town'
  name TEXT NOT NULL,                        -- 'Camden Town'
  owner TEXT,                                -- 'Heineken', or NULL if independent
  -- 'svg' or 'png' when public/breweries/<id>.<ext> exists, otherwise NULL (initials are shown).
  -- Filled in automatically by seed/build-seed-sql.mjs from what is in that folder.
  logo TEXT CHECK (logo IS NULL OR logo IN ('svg', 'png'))
);

ALTER TABLE beers ADD COLUMN brewery_id TEXT REFERENCES breweries (id);
CREATE INDEX beers_brewery ON beers (brewery_id);
