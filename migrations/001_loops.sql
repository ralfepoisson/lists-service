CREATE TABLE IF NOT EXISTS loops (
  id UUID PRIMARY KEY,
  account_id VARCHAR(255) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description VARCHAR(2000),
  priority VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  outcome VARCHAR(2000) NOT NULL,
  due_date DATE,
  status VARCHAR(16) NOT NULL CHECK (status IN ('open', 'closed')),
  created_by_sub VARCHAR(255) NOT NULL,
  updated_by_sub VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS loops_account_status_due_idx
  ON loops (account_id, status, due_date ASC NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS loop_related_records (
  loop_id UUID NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  record_kind VARCHAR(32) NOT NULL CHECK (record_kind IN ('task', 'appointment', 'email', 'document', 'entity', 'other')),
  record_id VARCHAR(256) NOT NULL,
  label VARCHAR(256) NOT NULL,
  ordinal SMALLINT NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (loop_id, record_kind, record_id)
);
