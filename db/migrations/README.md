# Storage Contract and Migration State

## 0014_saved_schema_drafts.sql

This migration adds one per-project draft table after 0013. It does not modify or backfill existing rows, aggregates, or schemas. Only the project
owner explicitly saves and reads incomplete JSON and version input. One row is kept per project, and every save creates a new revision.
Conditional storage and authorization checks run in the same database batch. Publishing, version reservation, and review confirmation are not stored.

The production order is database expansion, then Collector, then administrator screen. A code rollback leaves the table in place to preserve
drafts. A destructive rollback loses drafts, so it requires a separate backup and approval. Deleting a project deletes its draft; include drafts
in backups until then. Before and after application, check existing table row counts,
`PRAGMA foreign_key_check`, the result of running initialization twice, and draft create/update CAS and read authorization.
Apply and verify locally only; remote D1 is unchanged.

## 0013_workflow_failure_reasons.sql

Apply this migration after 0012. It adds `workflow_attempts.failure_reason_slot` and a
33-cell `failure_reason_counts_json` to `workflow_daily_counts`. Positions 0 to 31 are the sorted enum positions for that version;
position 32 means the reason is missing. Existing rows expand to an array of zeroes, leaving prior failures unmeasured.
Each value is a nonnegative safe integer, the sum is at most `failed_count`, and an attempt slot is allowed only for failure.
Values are added in the same UPDATE as the existing completion update in the CAS batch, with no additional query.

Deploy the new Collector after the database expansion. When rolling back to the previous collector, keep the columns and aggregates.
Do not backfill historical failures or store raw error messages. The production duration of CHECK validation is
unmeasured, so confirm application time against production data volume. After application,
check `PRAGMA foreign_key_check`, slot totals of at most `failed_count`, and repeated initialization.
Only local checks were performed; remote D1 migrations were not run.

Status: The [DBML](../schema.dbml) logical contract, SQL for the initial empty database in `0001_initial.sql`, and expansion migrations
`0002` through `0014` are present. The current head is `0014_saved_schema_drafts.sql`, with
14 migrations in total and 17 application tables. All were applied only in local Miniflare storage tests; none has been applied to remote D1.

Storage structure follows [schema.dbml](../schema.dbml), semantics follow the
[Event Contract](../../docs/backend/event-contract.md), and implementation state and expiration cleanup follow
[Collector Implementation](../../docs/backend/collector.md). Run commands are in
[DEVELOPMENT.md](../../DEVELOPMENT.md), and current verification state is in
[VALIDATION.md](../../VALIDATION.md).

## Migration Catalog and Initialization Detection — 2026-10-23

The reviewed list of 13 names in `tools/provision/migrations.ts` is the single source for the SQL hashes used by init, the storage D1 test
fixtures, and restore drills. `loadMigrations` stops before a database query or application if the SQL filenames in the directory
do not exactly match the catalog. Each call creates new name, SQL, and split-statement arrays, so modifying an array in one call does not affect
the next initialization.

Statement splitting supports only the existing rules for repository SQL. It removes full-line `--` comments,
keeps a `CREATE TRIGGER ... END;` body together, and splits on a trailing `;`. It is not a general SQL
parser, so semicolons in strings or identifiers and block comments are outside these rules. A new SQL file is applied only after its name is added
to the catalog and the required schema checks (tables, columns, constraints, triggers, and indexes) are updated with it. This documentation change did not alter existing migration SQL or
apply anything to remote D1.

## 0012_workflow_duration.sql

This migration adds a fixed-length 12-cell JSON integer array to `workflow_daily_counts`. Bucket order is
under 1 second, 1 to 5 seconds, 5 to 30 seconds, 30 seconds to 2 minutes, 2 to 10 minutes, and 10 minutes to 24 hours; success and failure alternate in the array.
Each value is a safe nonnegative integer, and the measured total per result cannot exceed the existing success or failure count.
Past rows default to an array of zeroes, and the difference from completion counts is reported as unmeasured. Old attempts are not
backfilled or filled. The new collector aggregates in the same UPDATE of the existing CAS-protected batch.

Deployment order is database expansion, then the new Collector and administrator. The previous collector uses named
INSERT and UPDATE columns, so it continues to work after expansion, but completions added during that interval are unmeasured.
Rollback retains the column and restores the previous collector; it does not drop the column or backfill aggregates.
ALTER CHECK validation reads existing rows, so verify production data volume and application time separately before applying. Local initialization checks for the column and
required constraints and skips reapplication.
After application, check `PRAGMA foreign_key_check` and the measured total versus success and failure count invariants.

## 0001_initial.sql

This migration creates tables for projects, administrator grants, immutable schema snapshots, receipts, attempts, UTC daily quota, per-minute
admission, and event and goal daily aggregates. It includes value CHECKs,
composite keys containing the project, the `(project_id, schema_version)` foreign key, and expiration and retention indexes.

- `projects.ingest_revision` is the ingestion adapter's CAS guard. The CHECK constraint
  `tallyfin_ingest_revision` requires an integer type and a safe integer of 0 or greater, and writing `-1` in the guard
  rolls back the whole batch.
- The `immutable_schema` and `immutable_project_zone` triggers prevent changes to schema definitions and project
  ID or time zone. A time-zone change is handled as a new project.
- CHECK constraints require receipt `expires_at = received_at + 48h` and attempt `expires_at = started_at + 72h`.
  The adapter calculates daily quota expiration (72 hours after the end of the UTC date).
- When attempt state has `terminal_kind`, `terminal_at` must not be NULL and must be at or after `started_at`
  and within 24 hours.
- A goal aggregate CHECK maintains `succeeded + failed <= started`.
- Aggregate `count` and `started/succeeded/failed` values have integer-type and safe-integer upper-bound CHECKs.

This file is for a newly created empty database. Migration of existing data, remote application, and rollback were
not run in this scope. Expiration cleanup is handled by the adapter's `cleanup` and the locally implemented Worker
scheduler. Remote activation is separate work.

Verification loads 14 migrations from 0001 through 0014 in order into Miniflare D1 through the storage adapter and collector tests,
checking constraints, triggers, CAS, quota, and cleanup.

## 0002_retention_cleanup.sql

This migration adds the single-row `retention_cleanup_state` table after 0001. It keeps only the last
project ID between scheduled runs and the cursor CAS revision, and does not change or backfill existing tables or data.
The first cleanup call initializes the `id=1` row. It adds no separate index or scan of existing large tables.

Application verification applies 0002 to a Miniflare database with existing projects and receipts and confirms rows remain, then tests
traversal, paused projects, deleted cursor targets, and concurrent-result conflicts. Before and after production application,
check for the new table and compare existing project and receipt row counts. Remote migration was not run.

To roll back, stop the Cron Trigger and use the previous code. The new table may remain.
Expired data already deleted by cleanup cannot be restored by rolling back the migration; use
a separate backup if recovery is needed. Follow the [operational conditions](../../docs/backend/retention-cleanup.md).

## 0003_project_creation.sql

`project_creators` stores explicit creator authorization and a limit of 1 to 1000 per issuer and subject.
Existing project owners do not automatically receive creator authorization. `project_creations` immutably stores the creator, original request hash,
and creation time of projects created through the API. It does not backfill existing projects or
grants. Creation records are retained for the life of the project, and revoking and regranting authorization does not
reset the project-count limit. Visitor data and raw request bodies are not stored.

The project INSERT, creation record, and initial owner grant are one D1 batch. The INSERT rechecks creator authorization and
the count limit, and later writes run only when the preceding INSERT succeeds. Local D1 verifies
concurrent requests, limits, authorization revocation, and rollback after an intermediate failure. Remote application has not been done.
The added tables may remain when reverting to earlier code. Apply after 0001 and 0002 on a production database.

## 0004_collection_rejections.sql

This migration adds only `rejections_json`, with a default of `{}`, to the existing `ingest_minute_usage`. Existing admission
counts and keys remain, and past rejections are not backfilled. It applies a CHECK for a JSON object of at most 2 KiB, and the
adapter accepts only fixed cause codes, counts, and times within the minute. A per-minute limit breach is aggregated atomically in existing
admission SQL. Other rejection records are added once only for requests that passed admission. It adds no database round trip for normal requests.
HTTP ingestion and administrator reads are also connected locally.

Only minutes with rejection records are retained for 7 UTC dates including today, while minutes without records retain the existing 2-minute
cleanup. Reads also exclude dates outside the same 7 days. The maximum physical rows within the window is 10,080 per project, and the deletion limit per cleanup call
is unchanged. Reads check the project reader or owner grant and records in one D1 batch. Recording is best-effort and includes no raw data, source, IP, or token.

The local initialization tool checks whether the ALTER target column exists so it can distinguish preview, apply, and reapplication.
Apply it after 0001 through 0003 before using the new code. Local Miniflare verifies existing counter retention, reapplication, constraints, and new-database initialization.
Before and after production application, check for the column, existing counters, and project row counts; remote application has not been performed. A rollback to the previous code
may keep the column, but the previous cleanup deletes rejection records after 2 minutes, so the 7-day history may not be preserved.

## 0005_admin_changes.sql

This migration adds an append-only `admin_changes` table for control-plane change history. It does not change existing tables or
data and does not backfill previous changes. API project creation, settings changes,
schema publication, and grant changes and offline provisioning CLI register and grant changes are each recorded in the same
D1 batch. When one operation changes several kinds, one row is created per change kind, so one CLI
register can leave rows for creation, settings, schema publication, and status change together.

- `actor_kind` is `administrator` or `local_operator`. The administrator API records the verified
  issuer and subject, while the CLI has no authenticated person and records NULL identifiers; the target account is never inferred
  as the actor.
- `fields_json` contains only settings field names that actually changed, `schema_version` contains only the schema operation and
  number, and `target_issuer`, `target_subject`, `before_role`, and `after_role` contain only the target and previous and new roles of a grant change.
  Raw request bodies, settings values, schema definitions, tokens, and visitor data are
  not included.
- A request with no value, a failure, or a settings request whose actual values do not change adds no row. The administrator API
  inserts only when the preceding write changes one row, and the offline CLI includes history in the apply batch only when there is a change.
  In either case, a batch rollback removes the history too.
- The `validate_admin_change_fields` BEFORE INSERT trigger limits settings field names to an allowlist
  (`name`, `status`, `allowedOrigins`, `requestsPerMinute`, and `newReceiptsPerUtcDay`) and rejects duplicate
  field names.
- The `immutable_admin_change` BEFORE UPDATE trigger blocks modification and updates, and the
  `admin_changes_project_time` index supports cleanup by `(project_id, occurred_at DESC, id DESC)`.
- Records are retained for a rolling 90 days per project. Scheduled cleanup deletes up to 500 rows per project,
  and a direct `cleanup` call deletes up to 1000 rows per project and table. The owner-only read API and screen are the next slice and do not exist yet.

Apply 0005 after 0001 through 0004, then use the new code. 0005 is additive, so existing
project, schema, and aggregate rows must remain unchanged.

| Stage | Check |
| --- | --- |
| Before application | Application state of `0001` through `0004`; existing row counts in `projects`, `project_schemas`, and aggregate tables |
| After application | Presence of the `admin_changes` table, indexes, and triggers; unchanged existing row counts; new changes recorded only inside a batch |

Local Miniflare checks two paths: a fresh path that applies 0001 through 0005 in order to an empty database and an upgraded path that adds only
0005 to a database with 0001 through 0004. Both check tables, CHECK constraints, triggers, indexes, and absence of records outside a batch; nothing is applied to remote D1.

Rollback restores previous code and may leave the added table. New change recording stops, but expired history
already deleted by cleanup is not recovered by a migration rollback.

## 0006_server_collection.sql

This migration adds `project_publishers` and broadens the source CHECK on `event_receipts` and `event_daily_counts`
from `browser` to `browser|server`. SQLite does not support ALTER for changing a CHECK, so the migration creates both
tables with the new definition, copies existing rows, drops the old tables, and renames the new ones. Copied
columns are unchanged, and the `event_receipts_expiry` and `event_daily_counts_retention` indexes are
recreated. The `(project_id, schema_version)` foreign keys and existing CHECKs are also included in the new definitions.
`workflow_attempts` and `workflow_daily_counts` retain their browser-only constraints and are untouched.
Temporary names are `event_receipts_next` and `event_daily_counts_next`, and all of 0006 is applied in one batch.
The test also forces the final statement of 0006 to fail and confirms that existing rows, constraints, and markers
roll back unchanged.

`project_publishers` stored only `(project_id, issuer, subject, created_at)` and starts empty in a new database. Publishing authorization is not automatically
created from existing `project_grants`, and no backfill is performed. Administrator reader and owner status and publishing authorization are independent.
Migration 0009 recreates this table to add `grant_id`. Its definition is described in the 0009 section.

This file is more expensive than 0001 through 0005 because it copies tables. Before production application, stop ingestion,
back up, and check the following. Only local Miniflare was checked; no production backup or application was run.

| Stage | Check |
| --- | --- |
| Before application | Application state of `0001` through `0005`; control-plane, schema, receipt, and aggregate row counts; backup exists |
| During application | Ingestion is stopped; a batch rollback leaves the previous tables intact |
| After application | Receipt and aggregate row counts match before application; source CHECK, indexes, and foreign keys exist; `project_publishers` is empty; browser ingestion and reads work |

Local initialization (`provision init`) reads the name and SQL of `sqlite_master` and checks both the stable 0006 marker, existence of
`project_publishers`, and that the source CHECK on `event_receipts` and `event_daily_counts` is broadened to
`browser|server`. If those conditions disagree or
`event_receipts_next` or `event_daily_counts_next` remains, it treats the database as incomplete and stops application.
It checks row preservation and source-constraint expansion separately on a fresh path applying 0001 through 0006 to an empty database and an upgraded path adding only
0006 to a database with 0001 through 0005.

Rollback restores the previous browser code and leaves the expanded tables. It does not delete stored server rows
for rollback and turns off server ingestion. It also does not delete `project_publishers` authorization.

## 0007_task_funnels.sql

This migration adds two tables: linkage state `funnel_runs` and funnel step aggregates `funnel_daily_counts`.
It does not copy existing tables or backfill data, and it is applied in one batch after `0001` through `0006`.
The new tables start empty.

- `funnel_runs` uses `(project_id, run_id)` as its primary key and stores the project, schema version, funnel, start
  time, start date, dimensions, and step-time array. The core checks `run_id` as UUIDv4, and
  SQL checks its 36-character length.
  `funnel_id` is 1 to 48 characters, and the step-time array has 2 to 10 entries and is at most 256 bytes.
- A CHECK enforces `expires_at = started_at + 72 hours`, and retransmission does not extend it.
  The `funnel_runs_expiry` index supports cleanup by `(project_id, expires_at)` and there is a
  `(project_id, schema_version)` foreign key.
- `funnel_daily_counts` stores consecutive reach counts for a start-date cohort with primary key
  `(project_id, schema_version, cohort_date, funnel_id, dimension_key, step_index)`.
  The `funnel_daily_retention` index supports 90-day cleanup by `(project_id, cohort_date)`.
- The `funnel_run_insert` and `funnel_run_update` triggers check step-time type, the 24-hour window,
  first step equals start time, and nondecreasing order, and roll back the batch on a violation.
- The `funnel_daily_insert` and `funnel_daily_update` triggers enforce nonincreasing reach counts for adjacent steps.
  Existing key candidates are verified by this UPDATE condition, not by a delta value.
- The migration adds two tables, four triggers, and two indexes.

| Stage | Check |
| --- | --- |
| Before application | Application state of `0001` through `0006`; existing row counts in `projects`, `project_schemas`, receipts, and aggregates |
| After application | Both tables, four triggers, and two indexes exist; existing row counts are unchanged; `funnel_runs` is empty; `PRAGMA foreign_key_check` returns no rows |

Local initialization (`provision init`) checks `sqlite_master` for both tables and all four triggers and the
`funnel_runs_expiry` and `funnel_daily_retention` indexes when both tables exist. If any are missing, it treats the database
as incomplete and stops. It checks existing-row preservation and new-table creation separately on a fresh path applying 0001 through 0007 to an empty database and an upgraded path
adding only 0007 to a database with 0001 through 0006.

Rollback restores previous code and may leave the added tables. Turning off funnel ingestion stops new linkage and step
aggregates. Expired linkage and old start-date cohorts already deleted by cleanup are not restored by rolling back the migration.

## 0008_publisher_history.sql

This migration copies and recreates `admin_changes` to broaden the action CHECK with `publisher.granted` and `publisher.revoked`.
Because SQLite does not support ALTER for changing a CHECK, it creates the new definition, copies existing rows, and renames the table.
The 13 columns remain unchanged, existing history rows are preserved, and no backfill is performed.
For publisher actions, `target_issuer` and `target_subject` contain the target of the publishing authorization change, and unlike administrator
grant changes, the role columns (`before_role` and `after_role`) are not used.
The `admin_changes_project_time` index and the `validate_admin_change_fields` and
`immutable_admin_change` triggers are also included in the new definition. All of 0008 is applied in one D1 batch.

It is the only migration that changes existing `admin_changes`, so before production application stop administrator API and CLI
writes, back up, and compare row counts and foreign keys before and after. Only local Miniflare has been checked,
and it has not been applied to remote D1.

| Stage | Check |
| --- | --- |
| Before application | Application state of `0001` through `0007`; `admin_changes` row count and distribution by action; backup exists; administrator API and CLI writes stopped |
| After application | 13 columns and existing rows preserved; action CHECK includes `publisher.granted` and `publisher.revoked`; indexes and triggers exist; `PRAGMA foreign_key_check` returns no rows |

Rollback restores previous code and may leave the expanded schema. Do not put an older administrator history reader that cannot interpret
the new action back over new rows. Prefer keeping a reader that recognizes the actions and fixing forward over restoring the older reader.

## 0009_publisher_generations.sql

This migration copies and recreates `project_publishers` to add the immutable grant ID `grant_id` to each publishing authorization. Because SQLite
does not support ALTER to add a UNIQUE column with an automatic default to an existing table, it creates the new definition, copies rows, and renames the table.
Copied columns are `project_id`, `issuer`, `subject`, and `created_at` unchanged; existing publishing rows are preserved and no backfill is performed.

- `grant_id` is a 32-character lowercase hex value with the default `lower(hex(randomblob(16)))`. A CHECK allows only length 32 and
  `0-9a-f`, and UNIQUE prevents duplicates. It is not a credential or authentication token; it is a nonsecret concurrency marker that distinguishes
  revocation and regrant.
- The `immutable_publisher_generation` BEFORE UPDATE trigger rejects changes to existing rows. To change authorization,
  delete and reinsert with a supported tool. A regrant receives a new ID even within the same millisecond.
- The `(project_id, issuer, subject)` primary key and the `projects(id)` foreign key remain unchanged.
- All of 0009 is applied in one D1 batch. Only the publishing authorization table is copied, so it is smaller than the receipt and aggregate
  copy in 0006.

The `publisher-grant` and `publisher-revoke` CLI commands use project creation time and the current row's `grant_id` as the CAS basis.
A stale revocation of a grant regranted in the same millisecond therefore sees a zero-row change and ends with `apply_conflict`.
The HTTP `DELETE /v1/projects/{projectId}/publishers` and administrator publishing screen also use `grantId` CAS, and the former `expectedCreatedAt` DELETE is rejected with 400.

Before production application, stop publisher CLI and HTTP writes, back up, and compare publishing row counts and IDs before and after.
Only local Miniflare has been checked, and it has not been applied to remote D1.

The application order is stop writes and back up, apply 0009, update the collector API and administrator screen together, then check listing and revocation
before resuming writes. The old screen's response validator does not match the added `grantId`, so the new screen must be reloaded. No compatibility path for
revoking with the former `expectedCreatedAt` request is provided.

| Stage | Check |
| --- | --- |
| Before application | Application state of `0001` through `0008`; `project_publishers` row count and `(project_id, issuer, subject, created_at)` values; backup exists; publisher CLI and HTTP writes stopped |
| During application | A batch rollback leaves the previous table and rows intact |
| After application | Publishing row count matches before application; each row's `project_id`, `issuer`, `subject`, and `created_at` are unchanged; `grant_id` is a different 32-character lowercase hex value per row; UNIQUE, CHECK, and trigger exist; `PRAGMA foreign_key_check` returns no rows |

Local initialization (`provision init`) checks `sqlite_master` for the 32-character hex
`grant_id`, UNIQUE, and CHECK in the `project_publishers` definition and the `immutable_publisher_generation` BEFORE UPDATE trigger.
If `project_publishers_next` remains or a constraint or trigger is missing, it treats the database as incomplete and stops.
It checks existing-row preservation and ID generation separately on a fresh path applying 0001 through 0009 to an empty database and an upgraded path adding only
0009 to a database with 0001 through 0008.

Rollback restores previous code and may leave the new column and trigger. Earlier CLI code uses creation-time CAS again, so a stale revocation becomes possible
again for same-millisecond regrants. Prefer keeping the `grant_id`-based code and fixing forward over reverting.

## 0010_grant_revision.sql

Apply `0010_grant_revision.sql` atomically before updating the Collector and admin.
Existing grant rows remain unchanged. Grant insert/delete/role-update triggers advance
`projects.grant_revision`, independently of ingestion. Reviewed writes send the list's
`grantRevision` as `expectedRevision`; missing or stale revisions cannot change state
and return `grant_conflict`. No-op readback remains available for exact retries.
Older admin builds must be upgraded to edit grants. Offline plans also compare this
revision. Local initialization refuses a revision column without all three triggers.

## 0011_analytics_lookup.sql

Adds event and funnel lookup indexes without changing rows, keys or query responses.
The event index places event_name before the date range, removing the daily query's
temporary sort. The funnel index places funnel_id before the date range and orders
steps for daily grouping. Breakdown still sorts dimension/step within a cohort date.
No workflow index is added: the existing primary key already supports that query plan.

Apply both CREATE INDEX statements as one D1 batch after 0010. Before applying, verify
backups, current row counts and index absence; schedule the build for a quiet period.
Index creation scans existing aggregates, consumes storage and blocks other work on
the database; additional ingest writes must maintain both indexes. No production
latency or index-build duration is claimed by the local EXPLAIN QUERY PLAN checks.
After applying, verify both index definitions, unchanged row counts, foreign keys and
event/funnel results. Local initialization detects complete indexes and refuses partial
or changed definitions. The installation schema checker includes both indexes.

Rollback leaves the indexes in place with older code. To reclaim space, drop both
indexes in one batch; row data and older query behavior remain intact. Reapplying
0011 restores them. Remote application has not been performed.
