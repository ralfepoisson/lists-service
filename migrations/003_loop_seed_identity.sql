ALTER TABLE loops ADD COLUMN IF NOT EXISTS seed_key VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS loops_account_seed_key_uidx
  ON loops (account_id, seed_key);
