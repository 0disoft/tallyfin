-- Apply as one atomic D1 batch after 0001..0006. No backfill or existing table rebuild.
CREATE TABLE funnel_runs (
  project_id TEXT NOT NULL, run_id TEXT NOT NULL CHECK (length(run_id) = 36),
  schema_version INTEGER NOT NULL, funnel_id TEXT NOT NULL CHECK (length(funnel_id) BETWEEN 1 AND 48),
  started_at INTEGER NOT NULL CHECK (typeof(started_at) = 'integer' AND started_at BETWEEN 0 AND 8639999740800000),
  cohort_date TEXT NOT NULL CHECK (length(cohort_date) = 10),
  dimension_key TEXT NOT NULL CHECK (json_valid(dimension_key) AND length(CAST(dimension_key AS BLOB)) <= 512),
  step_times_json TEXT NOT NULL CHECK (json_valid(step_times_json) AND json_type(step_times_json) = 'array'
    AND json_array_length(step_times_json) BETWEEN 2 AND 10 AND length(CAST(step_times_json AS BLOB)) <= 256),
  expires_at INTEGER NOT NULL CHECK (expires_at = started_at + 259200000),
  PRIMARY KEY (project_id, run_id), FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
CREATE INDEX funnel_runs_expiry ON funnel_runs(project_id, expires_at);

CREATE TRIGGER funnel_run_insert BEFORE INSERT ON funnel_runs
WHEN EXISTS (SELECT 1 FROM json_each(NEW.step_times_json) a WHERE a.type NOT IN ('integer','null')
  OR (a.type = 'integer' AND (a.value < NEW.started_at OR a.value > NEW.started_at + 86400000
    OR (a.key = 0 AND a.value != NEW.started_at)))
  OR EXISTS (SELECT 1 FROM json_each(NEW.step_times_json) b WHERE b.key < a.key AND b.type = 'integer' AND b.value > a.value))
BEGIN SELECT RAISE(ABORT, 'tallyfin_funnel_state'); END;
CREATE TRIGGER funnel_run_update BEFORE UPDATE ON funnel_runs
WHEN EXISTS (SELECT 1 FROM json_each(NEW.step_times_json) a WHERE a.type NOT IN ('integer','null')
  OR (a.type = 'integer' AND (a.value < NEW.started_at OR a.value > NEW.started_at + 86400000
    OR (a.key = 0 AND a.value != NEW.started_at)))
  OR EXISTS (SELECT 1 FROM json_each(NEW.step_times_json) b WHERE b.key < a.key AND b.type = 'integer' AND b.value > a.value))
BEGIN SELECT RAISE(ABORT, 'tallyfin_funnel_state'); END;

CREATE TABLE funnel_daily_counts (
  project_id TEXT NOT NULL, schema_version INTEGER NOT NULL, cohort_date TEXT NOT NULL CHECK (length(cohort_date) = 10),
  funnel_id TEXT NOT NULL CHECK (length(funnel_id) BETWEEN 1 AND 48),
  dimension_key TEXT NOT NULL CHECK (json_valid(dimension_key) AND length(CAST(dimension_key AS BLOB)) <= 512),
  step_index INTEGER NOT NULL CHECK (typeof(step_index) = 'integer' AND step_index BETWEEN 0 AND 9),
  reached_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reached_count) = 'integer' AND reached_count BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY (project_id, schema_version, cohort_date, funnel_id, dimension_key, step_index),
  FOREIGN KEY (project_id, schema_version) REFERENCES project_schemas(project_id, version)
);
CREATE INDEX funnel_daily_retention ON funnel_daily_counts(project_id, cohort_date);

-- Existing-key candidates are validated by the conflict UPDATE trigger, not by their delta value.
CREATE TRIGGER funnel_daily_insert BEFORE INSERT ON funnel_daily_counts
WHEN NOT EXISTS (SELECT 1 FROM funnel_daily_counts d WHERE d.project_id=NEW.project_id AND d.schema_version=NEW.schema_version
  AND d.cohort_date=NEW.cohort_date AND d.funnel_id=NEW.funnel_id AND d.dimension_key=NEW.dimension_key AND d.step_index=NEW.step_index)
AND ((NEW.step_index > 0 AND NEW.reached_count > coalesce((SELECT d.reached_count FROM funnel_daily_counts d
  WHERE d.project_id=NEW.project_id AND d.schema_version=NEW.schema_version AND d.cohort_date=NEW.cohort_date
  AND d.funnel_id=NEW.funnel_id AND d.dimension_key=NEW.dimension_key AND d.step_index=NEW.step_index-1),0))
OR NEW.reached_count < coalesce((SELECT d.reached_count FROM funnel_daily_counts d WHERE d.project_id=NEW.project_id
  AND d.schema_version=NEW.schema_version AND d.cohort_date=NEW.cohort_date AND d.funnel_id=NEW.funnel_id
  AND d.dimension_key=NEW.dimension_key AND d.step_index=NEW.step_index+1),0))
BEGIN SELECT RAISE(ABORT, 'tallyfin_funnel_order'); END;
CREATE TRIGGER funnel_daily_update BEFORE UPDATE ON funnel_daily_counts
WHEN (NEW.step_index > 0 AND NEW.reached_count > coalesce((SELECT d.reached_count FROM funnel_daily_counts d
  WHERE d.project_id=NEW.project_id AND d.schema_version=NEW.schema_version AND d.cohort_date=NEW.cohort_date
  AND d.funnel_id=NEW.funnel_id AND d.dimension_key=NEW.dimension_key AND d.step_index=NEW.step_index-1),0))
OR NEW.reached_count < coalesce((SELECT d.reached_count FROM funnel_daily_counts d WHERE d.project_id=NEW.project_id
  AND d.schema_version=NEW.schema_version AND d.cohort_date=NEW.cohort_date AND d.funnel_id=NEW.funnel_id
  AND d.dimension_key=NEW.dimension_key AND d.step_index=NEW.step_index+1),0)
BEGIN SELECT RAISE(ABORT, 'tallyfin_funnel_order'); END;
