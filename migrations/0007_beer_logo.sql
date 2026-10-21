-- A few beers are better known than the brewery that makes them: Hop House 13 (Guinness),
-- Old Speckled Hen (Greene King). Those can carry their own logo, which wins over the
-- brewery's. Set from whatever is in public/beers/ by seed/build-seed-sql.mjs.

ALTER TABLE beers ADD COLUMN logo TEXT CHECK (logo IS NULL OR logo IN ('svg', 'png'));
