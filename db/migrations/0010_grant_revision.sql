-- Apply atomically. Existing grants and all five grant columns remain unchanged.
ALTER TABLE projects ADD COLUMN grant_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(grant_revision) = 'integer' AND grant_revision BETWEEN 0 AND 9007199254740991);
CREATE TRIGGER grant_revision_insert AFTER INSERT ON project_grants
BEGIN
  UPDATE projects SET grant_revision = grant_revision + 1 WHERE id = NEW.project_id;
END;
CREATE TRIGGER grant_revision_delete AFTER DELETE ON project_grants
BEGIN
  UPDATE projects SET grant_revision = grant_revision + 1 WHERE id = OLD.project_id;
END;
CREATE TRIGGER grant_revision_update AFTER UPDATE ON project_grants
WHEN NEW.role IS NOT OLD.role
BEGIN
  UPDATE projects SET grant_revision = grant_revision + 1 WHERE id = NEW.project_id;
END;
