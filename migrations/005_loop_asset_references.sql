-- Widen only the existing opaque reference kind allowlist; preserve all rows.
ALTER TABLE loop_related_records
  DROP CONSTRAINT IF EXISTS loop_related_records_record_kind_check;

ALTER TABLE loop_related_records
  ADD CONSTRAINT loop_related_records_record_kind_check
  CHECK (record_kind IN ('task', 'appointment', 'email', 'document', 'entity', 'asset', 'other'));
