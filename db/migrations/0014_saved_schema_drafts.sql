-- Additive control-plane storage. One owner-only shared draft per project; no version reservation.
CREATE TABLE project_schema_drafts (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision TEXT NOT NULL CHECK (length(revision) = 32 AND revision NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (length(CAST(payload_json AS BLOB)) <= 131072 AND json_valid(payload_json)
    AND json_type(payload_json) IS 'object'
    AND json_type(payload_json, '$.targetVersion') IS 'text'
    AND length(json_extract(payload_json, '$.targetVersion')) <= 32
    AND json_type(payload_json, '$.draftText') IS 'text'
    AND json_remove(payload_json, '$.targetVersion', '$.draftText') = '{}'),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at <= 8640000000000000)
);
