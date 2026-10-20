-- An optional shorter name for a beer, e.g. "Neck Oil" for "Beavertown Neck Oil".
-- Used for the examples in the search box. Everywhere else keeps the full name, so two
-- similar beers are never confused. Blank means "use the full name".

ALTER TABLE beers ADD COLUMN common_name TEXT;
