-- No provider token is copied from the protected server catalogue.
CREATE TABLE lists_todoist_connections (
  account_id TEXT PRIMARY KEY,
  encrypted_token TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
