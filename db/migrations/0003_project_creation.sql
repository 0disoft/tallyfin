-- Explicit control-plane permission. Existing project owners gain no creation authority.
CREATE TABLE project_creators (
  issuer TEXT NOT NULL, subject TEXT NOT NULL,
  max_projects INTEGER NOT NULL CHECK (typeof(max_projects) = 'integer' AND max_projects BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL, PRIMARY KEY (issuer, subject)
);
-- Keep the immutable original request hash for the lifetime of the project, including after settings edits.
-- No FK to project_creators: revoking/regranting permission must not erase history or reset the quota.
CREATE TABLE project_creations (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
  issuer TEXT NOT NULL, subject TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64), created_at INTEGER NOT NULL
);
CREATE INDEX project_creations_principal ON project_creations(issuer, subject, project_id);
CREATE TRIGGER immutable_project_creation BEFORE UPDATE ON project_creations
BEGIN SELECT RAISE(ABORT, 'immutable_project_creation'); END;
