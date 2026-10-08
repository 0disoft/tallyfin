-- Fresh database only. No remote database is provisioned or migrated by this file.
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  time_zone TEXT NOT NULL, allowed_origins_json TEXT NOT NULL CHECK (json_valid(allowed_origins_json)),
  requests_per_minute INTEGER NOT NULL CHECK (requests_per_minute BETWEEN 1 AND 600),
  new_receipts_per_utc_day INTEGER NOT NULL CHECK (new_receipts_per_utc_day BETWEEN 1 AND 1000000),
  latest_received_at INTEGER, created_at INTEGER NOT NULL,
  ingest_revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT tallyfin_ingest_revision CHECK (typeof(ingest_revision) = 'integer' AND ingest_revision BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE project_grants (
  project_id TEXT NOT NULL REFERENCES projects(id), issuer TEXT NOT NULL, subject TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reader', 'owner')), created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, issuer, subject)
);
CREATE INDEX project_grants_principal ON project_grants(issuer, subject, project_id);
CREATE TABLE project_schemas (
  project_id TEXT NOT NULL REFERENCES projects(id), version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  definitions_json TEXT NOT NULL CHECK (json_valid(definitions_json) AND length(CAST(definitions_json AS BLOB)) <= 32768),
  published_at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY (project_id, version)
);
CREATE TRIGGER immutable_schema BEFORE UPDATE OF definitions_json, version, project_id ON project_schemas
BEGIN SELECT RAISE(ABORT, 'immutable_schema'); END;
CREATE TRIGGER immutable_project_zone BEFORE UPDATE OF time_zone, id ON projects
BEGIN SELECT RAISE(ABORT, 'immutable_project_zone'); END;
CREATE TABLE event_receipts (
  project_id TEXT NOT NULL, source TEXT NOT NULL CHECK (source = 'browser'), event_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL, payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK (expires_at = received_at + 172800000),
  PRIMARY KEY (project_id, source, event_id), FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
CREATE INDEX event_receipts_expiry ON event_receipts(project_id, expires_at);
CREATE TABLE workflow_attempts (
  project_id TEXT NOT NULL, source TEXT NOT NULL CHECK (source = 'browser'), attempt_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL, workflow_id TEXT NOT NULL, started_at INTEGER NOT NULL, cohort_date TEXT NOT NULL,
  dimension_key TEXT NOT NULL CHECK (length(CAST(dimension_key AS BLOB)) <= 512 AND json_valid(dimension_key)),
  start_seen INTEGER NOT NULL DEFAULT 0 CHECK (start_seen IN (0, 1)),
  terminal_kind TEXT CHECK (terminal_kind IN ('success', 'failure')), terminal_at INTEGER,
  expires_at INTEGER NOT NULL CHECK (expires_at = started_at + 259200000),
  CHECK ((terminal_kind IS NULL AND terminal_at IS NULL) OR (terminal_kind IS NOT NULL AND terminal_at IS NOT NULL AND terminal_at >= started_at AND terminal_at <= started_at + 86400000)),
  PRIMARY KEY (project_id, source, attempt_id), FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
CREATE INDEX workflow_attempts_expiry ON workflow_attempts(project_id, expires_at);
CREATE TABLE ingest_daily_usage (
  project_id TEXT NOT NULL REFERENCES projects(id), utc_date TEXT NOT NULL,
  new_receipts INTEGER NOT NULL DEFAULT 0 CHECK (new_receipts BETWEEN 0 AND 9007199254740991),
  expires_at INTEGER NOT NULL, PRIMARY KEY (project_id, utc_date)
);
CREATE INDEX ingest_daily_usage_expiry ON ingest_daily_usage(project_id, expires_at);
CREATE TABLE ingest_minute_usage (
  project_id TEXT NOT NULL REFERENCES projects(id), minute_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 601), PRIMARY KEY (project_id, minute_start)
);
CREATE TABLE event_daily_counts (
  project_id TEXT NOT NULL, schema_version INTEGER NOT NULL, source TEXT NOT NULL CHECK (source = 'browser'),
  event_date TEXT NOT NULL, event_name TEXT NOT NULL,
  dimension_key TEXT NOT NULL CHECK (length(CAST(dimension_key AS BLOB)) <= 512 AND json_valid(dimension_key)),
  count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(count) = 'integer' AND count BETWEEN 0 AND 9007199254740991), updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, schema_version, source, event_date, event_name, dimension_key),
  FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
CREATE INDEX event_daily_counts_retention ON event_daily_counts(project_id, event_date);
CREATE TABLE workflow_daily_counts (
  project_id TEXT NOT NULL, schema_version INTEGER NOT NULL, source TEXT NOT NULL CHECK (source = 'browser'),
  cohort_date TEXT NOT NULL, workflow_id TEXT NOT NULL,
  dimension_key TEXT NOT NULL CHECK (length(CAST(dimension_key AS BLOB)) <= 512 AND json_valid(dimension_key)),
  started_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(started_count) = 'integer' AND started_count BETWEEN 0 AND 9007199254740991),
  succeeded_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(succeeded_count) = 'integer' AND succeeded_count BETWEEN 0 AND 9007199254740991),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(failed_count) = 'integer' AND failed_count BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL, CHECK (succeeded_count + failed_count <= started_count),
  PRIMARY KEY (project_id, schema_version, source, cohort_date, workflow_id, dimension_key),
  FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
CREATE INDEX workflow_daily_counts_retention ON workflow_daily_counts(project_id, cohort_date);
