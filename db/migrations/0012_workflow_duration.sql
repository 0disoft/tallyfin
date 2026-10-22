-- Expand only, after 0011. Old completions remain unmeasured; do not backfill expired attempts.
ALTER TABLE workflow_daily_counts ADD COLUMN duration_counts_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]'
  CHECK (json_valid(duration_counts_json) AND json_type(duration_counts_json) = 'array'
    AND json_array_length(duration_counts_json) = 12
    AND json_type(duration_counts_json, '$[0]') = 'integer' AND json_extract(duration_counts_json, '$[0]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[1]') = 'integer' AND json_extract(duration_counts_json, '$[1]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[2]') = 'integer' AND json_extract(duration_counts_json, '$[2]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[3]') = 'integer' AND json_extract(duration_counts_json, '$[3]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[4]') = 'integer' AND json_extract(duration_counts_json, '$[4]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[5]') = 'integer' AND json_extract(duration_counts_json, '$[5]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[6]') = 'integer' AND json_extract(duration_counts_json, '$[6]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[7]') = 'integer' AND json_extract(duration_counts_json, '$[7]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[8]') = 'integer' AND json_extract(duration_counts_json, '$[8]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[9]') = 'integer' AND json_extract(duration_counts_json, '$[9]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[10]') = 'integer' AND json_extract(duration_counts_json, '$[10]') BETWEEN 0 AND 9007199254740991
    AND json_type(duration_counts_json, '$[11]') = 'integer' AND json_extract(duration_counts_json, '$[11]') BETWEEN 0 AND 9007199254740991
    AND json_extract(duration_counts_json, '$[0]') + json_extract(duration_counts_json, '$[2]') + json_extract(duration_counts_json, '$[4]') + json_extract(duration_counts_json, '$[6]') + json_extract(duration_counts_json, '$[8]') + json_extract(duration_counts_json, '$[10]') <= succeeded_count
    AND json_extract(duration_counts_json, '$[1]') + json_extract(duration_counts_json, '$[3]') + json_extract(duration_counts_json, '$[5]') + json_extract(duration_counts_json, '$[7]') + json_extract(duration_counts_json, '$[9]') + json_extract(duration_counts_json, '$[11]') <= failed_count);
