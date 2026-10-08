-- Apply after 0001. Adds only bounded retention-job progress; no event data changes.
CREATE TABLE retention_cleanup_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  last_project_id TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991)
);
