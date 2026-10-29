-- Daily totals of how the site is used (SPEC section 9: counts only, never a person).
--
-- One row per day, kind and key. Nothing here can be tied to a visitor: there is no device
-- hash, no address and no time of day, only "this happened n times on this date".
--
--   kind     key
--   page     'home', 'about', 'faq', …    a page was opened
--   search   a beer id                     someone searched and found that beer
--   miss     the words typed               someone searched and found nothing
--   pub      a pub id                      someone opened that pub's list
--   map      ''                            someone opened the map
--   vote     ''                            a 👍 or 👎 was accepted
--   photo    ''                            a photo report was sent
--   beer     ''                            a beer was submitted
--   message  ''                            a message was sent through Tell us

CREATE TABLE stats (
  day TEXT NOT NULL,                    -- YYYY-MM-DD, UTC
  kind TEXT NOT NULL,
  key TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
) WITHOUT ROWID;
