-- Messages sent through the feedback box in the footer. Reviewed on the admin Ideas tab:
-- keeping one stores it as an idea to come back to; rejecting discards it.

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'kept', 'rejected')),
  -- Cleared after 30 days like every other device hash (housekeeping).
  device_hash TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX feedback_status ON feedback (status, created_at);
CREATE INDEX feedback_hashed_created ON feedback (created_at) WHERE device_hash IS NOT NULL;
