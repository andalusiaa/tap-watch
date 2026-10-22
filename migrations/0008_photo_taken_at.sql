-- When each photo was taken, read from the file on the sender's phone before the photo is
-- re-encoded (which strips everything else). Lets an older photo date the tap list properly
-- instead of counting as "checked today". NULL when the file didn't say.

ALTER TABLE photo_report_images ADD COLUMN taken_at TEXT;
