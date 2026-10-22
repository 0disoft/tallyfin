-- Expand after 0012. Old completed failures retain unknown measurement coverage.
ALTER TABLE workflow_attempts ADD COLUMN failure_reason_slot INTEGER
  CHECK (failure_reason_slot IS NULL OR (typeof(failure_reason_slot) = 'integer'
    AND failure_reason_slot BETWEEN 0 AND 32 AND terminal_kind IS 'failure'));
ALTER TABLE workflow_daily_counts ADD COLUMN failure_reason_counts_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'
  CHECK (json_valid(failure_reason_counts_json) AND json_type(failure_reason_counts_json) = 'array'
    AND json_array_length(failure_reason_counts_json) = 33
    AND json_type(failure_reason_counts_json, '$[0]') = 'integer' AND json_extract(failure_reason_counts_json, '$[0]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[1]') = 'integer' AND json_extract(failure_reason_counts_json, '$[1]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[2]') = 'integer' AND json_extract(failure_reason_counts_json, '$[2]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[3]') = 'integer' AND json_extract(failure_reason_counts_json, '$[3]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[4]') = 'integer' AND json_extract(failure_reason_counts_json, '$[4]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[5]') = 'integer' AND json_extract(failure_reason_counts_json, '$[5]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[6]') = 'integer' AND json_extract(failure_reason_counts_json, '$[6]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[7]') = 'integer' AND json_extract(failure_reason_counts_json, '$[7]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[8]') = 'integer' AND json_extract(failure_reason_counts_json, '$[8]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[9]') = 'integer' AND json_extract(failure_reason_counts_json, '$[9]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[10]') = 'integer' AND json_extract(failure_reason_counts_json, '$[10]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[11]') = 'integer' AND json_extract(failure_reason_counts_json, '$[11]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[12]') = 'integer' AND json_extract(failure_reason_counts_json, '$[12]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[13]') = 'integer' AND json_extract(failure_reason_counts_json, '$[13]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[14]') = 'integer' AND json_extract(failure_reason_counts_json, '$[14]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[15]') = 'integer' AND json_extract(failure_reason_counts_json, '$[15]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[16]') = 'integer' AND json_extract(failure_reason_counts_json, '$[16]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[17]') = 'integer' AND json_extract(failure_reason_counts_json, '$[17]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[18]') = 'integer' AND json_extract(failure_reason_counts_json, '$[18]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[19]') = 'integer' AND json_extract(failure_reason_counts_json, '$[19]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[20]') = 'integer' AND json_extract(failure_reason_counts_json, '$[20]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[21]') = 'integer' AND json_extract(failure_reason_counts_json, '$[21]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[22]') = 'integer' AND json_extract(failure_reason_counts_json, '$[22]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[23]') = 'integer' AND json_extract(failure_reason_counts_json, '$[23]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[24]') = 'integer' AND json_extract(failure_reason_counts_json, '$[24]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[25]') = 'integer' AND json_extract(failure_reason_counts_json, '$[25]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[26]') = 'integer' AND json_extract(failure_reason_counts_json, '$[26]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[27]') = 'integer' AND json_extract(failure_reason_counts_json, '$[27]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[28]') = 'integer' AND json_extract(failure_reason_counts_json, '$[28]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[29]') = 'integer' AND json_extract(failure_reason_counts_json, '$[29]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[30]') = 'integer' AND json_extract(failure_reason_counts_json, '$[30]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[31]') = 'integer' AND json_extract(failure_reason_counts_json, '$[31]') BETWEEN 0 AND 9007199254740991
    AND json_type(failure_reason_counts_json, '$[32]') = 'integer' AND json_extract(failure_reason_counts_json, '$[32]') BETWEEN 0 AND 9007199254740991
    AND json_extract(failure_reason_counts_json, '$[0]') + json_extract(failure_reason_counts_json, '$[1]') + json_extract(failure_reason_counts_json, '$[2]') + json_extract(failure_reason_counts_json, '$[3]') + json_extract(failure_reason_counts_json, '$[4]') + json_extract(failure_reason_counts_json, '$[5]') + json_extract(failure_reason_counts_json, '$[6]') + json_extract(failure_reason_counts_json, '$[7]') + json_extract(failure_reason_counts_json, '$[8]') + json_extract(failure_reason_counts_json, '$[9]') + json_extract(failure_reason_counts_json, '$[10]') + json_extract(failure_reason_counts_json, '$[11]') + json_extract(failure_reason_counts_json, '$[12]') + json_extract(failure_reason_counts_json, '$[13]') + json_extract(failure_reason_counts_json, '$[14]') + json_extract(failure_reason_counts_json, '$[15]') + json_extract(failure_reason_counts_json, '$[16]') + json_extract(failure_reason_counts_json, '$[17]') + json_extract(failure_reason_counts_json, '$[18]') + json_extract(failure_reason_counts_json, '$[19]') + json_extract(failure_reason_counts_json, '$[20]') + json_extract(failure_reason_counts_json, '$[21]') + json_extract(failure_reason_counts_json, '$[22]') + json_extract(failure_reason_counts_json, '$[23]') + json_extract(failure_reason_counts_json, '$[24]') + json_extract(failure_reason_counts_json, '$[25]') + json_extract(failure_reason_counts_json, '$[26]') + json_extract(failure_reason_counts_json, '$[27]') + json_extract(failure_reason_counts_json, '$[28]') + json_extract(failure_reason_counts_json, '$[29]') + json_extract(failure_reason_counts_json, '$[30]') + json_extract(failure_reason_counts_json, '$[31]') + json_extract(failure_reason_counts_json, '$[32]') <= failed_count);
