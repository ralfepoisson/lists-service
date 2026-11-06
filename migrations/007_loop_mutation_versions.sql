-- Additive optimistic freshness and durable Calendar append-operation receipts.
ALTER TABLE loops ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE IF NOT EXISTS loop_append_operations (
  account_id VARCHAR(255) NOT NULL,
  operation_id UUID NOT NULL,
  loop_id UUID NOT NULL,
  event_id UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  applied_version INTEGER NOT NULL CHECK (applied_version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, operation_id),
  FOREIGN KEY (account_id,loop_id) REFERENCES loops(account_id,id) ON DELETE CASCADE
);
