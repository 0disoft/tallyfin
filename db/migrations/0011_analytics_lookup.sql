-- Apply atomically after 0010. No row changes or table rebuilds.
CREATE INDEX event_daily_counts_lookup
  ON event_daily_counts(project_id, schema_version, source, event_name, event_date, dimension_key);
CREATE INDEX funnel_daily_counts_lookup
  ON funnel_daily_counts(project_id, schema_version, funnel_id, cohort_date, step_index, dimension_key);
