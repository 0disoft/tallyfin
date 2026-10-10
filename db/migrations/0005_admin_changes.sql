-- Additive control-plane history. No backfill of changes made before this migration.
CREATE TABLE admin_changes (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  project_id TEXT NOT NULL REFERENCES projects(id),
  occurred_at INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer' AND occurred_at BETWEEN 0 AND 8640000000000000),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('administrator', 'local_operator')),
  actor_issuer TEXT, actor_subject TEXT,
  action TEXT NOT NULL CHECK (action IN ('project.created', 'project.settings_changed', 'schema.published', 'schema.status_changed', 'grant.created', 'grant.role_changed', 'grant.revoked')),
  fields_json TEXT NOT NULL DEFAULT '[]' CHECK (length(fields_json) <= 256 AND json_valid(fields_json) AND json_type(fields_json) = 'array'),
  schema_version INTEGER CHECK (schema_version IS NULL OR (typeof(schema_version) = 'integer' AND schema_version BETWEEN 1 AND 2147483647)),
  target_issuer TEXT, target_subject TEXT,
  before_role TEXT CHECK (before_role IS NULL OR before_role IN ('reader', 'owner')),
  after_role TEXT CHECK (after_role IS NULL OR after_role IN ('reader', 'owner')),
  CHECK ((actor_kind = 'administrator' AND actor_issuer IS NOT NULL AND actor_subject IS NOT NULL)
    OR (actor_kind = 'local_operator' AND actor_issuer IS NULL AND actor_subject IS NULL)),
  CHECK ((action IN ('schema.published', 'schema.status_changed') AND schema_version IS NOT NULL)
    OR (action NOT IN ('schema.published', 'schema.status_changed') AND schema_version IS NULL)),
  CHECK ((action IN ('grant.created', 'grant.role_changed', 'grant.revoked') AND target_issuer IS NOT NULL AND target_subject IS NOT NULL)
    OR (action NOT IN ('grant.created', 'grant.role_changed', 'grant.revoked') AND target_issuer IS NULL AND target_subject IS NULL AND before_role IS NULL AND after_role IS NULL)),
  CHECK (action <> 'grant.created' OR (before_role IS NULL AND after_role IS NOT NULL)),
  CHECK (action <> 'grant.revoked' OR (before_role IS NOT NULL AND after_role IS NULL)),
  CHECK (action <> 'grant.role_changed' OR (before_role IS NOT NULL AND after_role IS NOT NULL AND before_role <> after_role)),
  CHECK ((action = 'project.settings_changed' AND json_array_length(fields_json) BETWEEN 1 AND 5)
    OR (action <> 'project.settings_changed' AND fields_json = '[]'))
);
CREATE INDEX admin_changes_project_time ON admin_changes(project_id, occurred_at DESC, id DESC);
CREATE TRIGGER validate_admin_change_fields BEFORE INSERT ON admin_changes
WHEN EXISTS (SELECT 1 FROM json_each(NEW.fields_json) WHERE type <> 'text'
  OR value NOT IN ('name', 'status', 'allowedOrigins', 'requestsPerMinute', 'newReceiptsPerUtcDay'))
  OR (SELECT count(*) FROM json_each(NEW.fields_json)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.fields_json))
BEGIN SELECT RAISE(ABORT, 'invalid_admin_change_fields'); END;
CREATE TRIGGER immutable_admin_change BEFORE UPDATE ON admin_changes
BEGIN SELECT RAISE(ABORT, 'immutable_admin_change'); END;
