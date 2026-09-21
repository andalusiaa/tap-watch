-- The admin Activity tab: a record of admin changes (kept for a year), plus indexes so the
-- tab can list recent votes, photo reports and beer submissions newest first.
-- Nothing new is stored about visitors.

CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  -- tap_list, photo_approved, photo_rejected, submission_approved, submission_rejected,
  -- pub_added, pub_changed, banner, beer_list
  action TEXT NOT NULL,
  pub_id TEXT,
  summary TEXT NOT NULL
);
CREATE INDEX admin_log_created ON admin_log (created_at);
CREATE INDEX admin_log_pub ON admin_log (pub_id, created_at);

CREATE INDEX votes_created ON votes (created_at);
CREATE INDEX photo_reports_created ON photo_reports (created_at);
CREATE INDEX suggestions_created ON suggestions (created_at);
