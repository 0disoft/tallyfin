-- Apply atomically after 0008, with permission writers stopped. Preserve existing permissions.
-- grant_id is a non-secret concurrency marker, never an authentication credential.
CREATE TABLE project_publishers_next (
  project_id TEXT NOT NULL REFERENCES projects(id),
  issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 8640000000000000),
  grant_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
    CHECK (length(grant_id) = 32 AND grant_id NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (project_id, issuer, subject),
  UNIQUE (grant_id)
);
INSERT INTO project_publishers_next (project_id, issuer, subject, created_at)
  SELECT project_id, issuer, subject, created_at FROM project_publishers;
DROP TABLE project_publishers;
ALTER TABLE project_publishers_next RENAME TO project_publishers;
CREATE TRIGGER immutable_publisher_generation BEFORE UPDATE ON project_publishers
BEGIN
  SELECT RAISE(ABORT, 'publisher_generation_immutable');
END;
