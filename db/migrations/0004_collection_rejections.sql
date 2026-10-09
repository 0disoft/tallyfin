-- Expand only: preserve admission counters and initialize no historical rejection data.
ALTER TABLE ingest_minute_usage ADD COLUMN rejections_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(rejections_json) AND json_type(rejections_json) = 'object'
    AND length(CAST(rejections_json AS BLOB)) <= 2048);
