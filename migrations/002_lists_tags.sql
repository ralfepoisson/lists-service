CREATE TABLE IF NOT EXISTS lists_tags (
  id UUID PRIMARY KEY,
  account_id VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL,
  normalized_name VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, normalized_name),
  UNIQUE (account_id, id)
);

CREATE TABLE IF NOT EXISTS lists_tag_assignments (
  account_id VARCHAR(255) NOT NULL,
  tag_id UUID NOT NULL,
  entity_kind VARCHAR(16) NOT NULL CHECK (entity_kind IN ('loop', 'task', 'item')),
  provider VARCHAR(16) NOT NULL CHECK (
    (entity_kind = 'loop' AND provider = 'lists') OR
    (entity_kind IN ('task', 'item') AND provider = 'todoist')
  ),
  list_id VARCHAR(256) NOT NULL DEFAULT '',
  entity_id VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, tag_id, entity_kind, list_id, entity_id),
  FOREIGN KEY (account_id, tag_id) REFERENCES lists_tags(account_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lists_tag_assignments_entity_idx
  ON lists_tag_assignments (account_id, entity_kind, list_id, entity_id, tag_id);
CREATE INDEX IF NOT EXISTS lists_tag_assignments_explore_idx
  ON lists_tag_assignments (account_id, tag_id, entity_kind, created_at DESC, entity_id);
