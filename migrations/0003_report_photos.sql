-- A photo report can now carry several photos (up to 4), one row each.
-- Existing reports keep their photo; the old columns on photo_reports go.

CREATE TABLE photo_report_images (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES photo_reports (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
  -- Key of the photo in the PHOTOS store; NULL once the photo is deleted.
  photo_key TEXT,
  photo_bytes INTEGER,
  UNIQUE (report_id, position)
);

INSERT INTO photo_report_images (report_id, position, photo_key, photo_bytes)
SELECT id, 1, photo_key, photo_bytes FROM photo_reports WHERE photo_key IS NOT NULL;

ALTER TABLE photo_reports DROP COLUMN photo_key;
ALTER TABLE photo_reports DROP COLUMN photo_bytes;
