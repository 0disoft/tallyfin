# Persistence Model

Status: [DBML](../../db/schema.dbml) and the SQL migrations were verified locally in Miniflare D1.
They have not been applied to a remote database.

Projects, immutable schemas, administrator grants, and daily event, goal, and funnel aggregates are stored.
`event_receipts` keeps an eventId and normalized payload hash instead of the raw event for 48 hours;
`workflow_attempts` keeps the minimal linkage state for each workflow for 72 hours after it starts.
`funnel_runs` keeps step timestamps for workflow linkage state (2 to 10 steps, with unreached steps as null) for 72 hours after start;
`funnel_daily_counts` keeps consecutive reach counts by start date, version, funnel, and dimensions for 90 days.
There are no visitor or raw event tables. Administrator issuer and subject belong to the control plane and are
not used for visitor analytics.

Receipts, attempts, the UTC daily new-receipt quota, aggregates, funnel linkage state, and step deltas are
written in the same D1 batch that increments `projects.ingest_revision`. If a concurrent write or a revocation of publishing
authorization rolls back the batch, receipts, quota, linkage, and aggregates cannot be left partially written. Daily aggregates cover the 90 days including the
project-local current day, while funnel step aggregates cover 90 days measured from the start date. The project and
version are included in every aggregate key and foreign key. Along with expiration, range, integer, and flow constraints, SQL triggers enforce
the 24-hour step-time window and nondecreasing order, and the nonincreasing count of consecutive reached steps; the core checks the same
rules and confirmed them in local tests. Detailed rules follow the
[Event Contract](./event-contract.md).

`retention_cleanup_state` is a single-row operational state separate from visitor and aggregate data. It stores the
last project ID and revision for expiration cleanup so traversal can continue after a Worker restart.
Detailed conditions follow [Automatic Cleanup](./retention-cleanup.md).
