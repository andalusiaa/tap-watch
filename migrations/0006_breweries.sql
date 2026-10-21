-- Breweries as their own records, named after the brand on the pump clip rather than the
-- group that owns it: Guinness, not Diageo; Camden Town, not Heineken. The owner is kept
-- alongside for reference. Each beer points at one brewery, which is what logos hang off.

CREATE TABLE breweries (
  id TEXT PRIMARY KEY,                       -- 'camden-town'
  name TEXT NOT NULL,                        -- 'Camden Town'
  owner TEXT,                                -- 'Heineken', or NULL if independent
  -- 1 once a logo file exists at public/breweries/<id>.svg
  has_logo INTEGER NOT NULL DEFAULT 0 CHECK (has_logo IN (0, 1))
);

ALTER TABLE beers ADD COLUMN brewery_id TEXT REFERENCES breweries (id);
CREATE INDEX beers_brewery ON beers (brewery_id);
