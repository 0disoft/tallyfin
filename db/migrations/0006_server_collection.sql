-- Apply as one atomic D1 batch after 0001..0005. Existing browser rows are preserved.
-- Rebuild only the two event tables whose source CHECK was browser-only.
CREATE TABLE event_receipts_next (
  project_id TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('browser', 'server')), event_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL, payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK (expires_at = received_at + 172800000),
  PRIMARY KEY (project_id, source, event_id), FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
INSERT INTO event_receipts_next SELECT * FROM event_receipts;
DROP TABLE event_receipts;
ALTER TABLE event_receipts_next RENAME TO event_receipts;
CREATE INDEX event_receipts_expiry ON event_receipts(project_id, expires_at);

CREATE TABLE event_daily_counts_next (
  project_id TEXT NOT NULL, schema_version INTEGER NOT NULL, source TEXT NOT NULL CHECK (source IN ('browser', 'server')),
  event_date TEXT NOT NULL, event_name TEXT NOT NULL,
  dimension_key TEXT NOT NULL CHECK (length(CAST(dimension_key AS BLOB)) <= 512 AND json_valid(dimension_key)),
  count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(count) = 'integer' AND count BETWEEN 0 AND 9007199254740991), updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, schema_version, source, event_date, event_name, dimension_key),
  FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
INSERT INTO event_daily_counts_next SELECT * FROM event_daily_counts;
DROP TABLE event_daily_counts;
ALTER TABLE event_daily_counts_next RENAME TO event_daily_counts;
CREATE INDEX event_daily_counts_retention ON event_daily_counts(project_id, event_date);

-- Stable migration marker and independent machine-publisher permission. Never backfill admin grants.
CREATE TABLE project_publishers (
  project_id TEXT NOT NULL REFERENCES projects(id),
  issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY (project_id, issuer, subject)
);
