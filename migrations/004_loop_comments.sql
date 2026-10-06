-- Composite ownership prevents a comment from belonging to a different tenant's Loop.
CREATE UNIQUE INDEX IF NOT EXISTS loops_account_id_id_idx ON loops (account_id, id);

CREATE TABLE IF NOT EXISTS loop_comments (
  id UUID PRIMARY KEY,
  account_id VARCHAR(255) NOT NULL,
  loop_id UUID NOT NULL,
  content VARCHAR(4000) NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  author_sub VARCHAR(255) NOT NULL CHECK (length(btrim(author_sub)) > 0),
  author_email VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL,
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY (account_id, loop_id) REFERENCES loops (account_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS loop_comments_account_loop_order_idx
  ON loop_comments (account_id, loop_id, ordinal);
