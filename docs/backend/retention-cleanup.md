# Automatic Expired-Data Cleanup

## Execution Results and Stop Causes

The final report records an `execution` for normal completion, exceptions, and cancellation alike. `elapsedMs` is the execution time measured
with a monotonic clock, and `stopReason` is one of `page_limit`, `time_budget`, `cycle_complete`, `empty_page`,
`cursor_conflict`, `cancelled`, or `storage_error`. A page or time limit means state carries over to the next execution; it does not mean all data was cleaned.
Deletion failures are counted separately. A scheduled run adds `scheduleLagMs`, measured only at start. A clock
error that starts the run early is shown as 0, and the deletion cutoff still uses `scheduledTime`.

`interruptedProjects` is the number of in-progress operations whose result could not be confirmed, and `checkpointedProjects` is
the number of attempts whose progress was confirmed by cursor CAS. A failed project still advances the cursor under existing policy,
so this value is not a successful deletion count. Do not judge the whole run from only the boolean result of the final CAS.
Cancellation does not guarantee rollback of a D1 operation already running. The optional synchronous `onReport` for `runCleanup` receives
one final snapshot, and observation failure or mutation of the passed object does not affect the original result or exception.

Status: The Worker `scheduled` handler and D1 traversal-position storage were implemented and verified locally.
Remote database application, Cron Trigger registration, and deployment have not been done.

## Execution and Limits

The `scheduled` handler in `apps/collector` runs `runCleanup` relative to `ScheduledController.scheduledTime` and awaits all work.
Cleanup does not run during HTTP ingestion or administrator read requests. This applies to `createWorker`, `createOidcWorker`, and the default export.

- By default, each run processes one page and at most 4 projects in ascending ID order. Paused projects are included.
  If the host confirms sufficient query budget and sets `cleanupMaxPages` from 1 to 4 on `createWorker`, it processes up to 4 pages and 16 projects
  sequentially. The OIDC factory also accepts the same `WorkerOptions` as its final optional argument. Installation configuration and the default export
  keep the value at 1.
- When the 20-second monotonic-clock budget expires, it starts no new project or page and saves the cursor only through the portion of the page it processed. The existing 30-second limit applies to total database waiting.
  If a project already processed in the same run is encountered again, it stops to prevent duplicate deletion during a short traversal.
- Scheduled cleanup deletes at least 500 and up to 10,000 rows from each of 9 tables per project. The targets are four tables that use expiration times—receipts,
  attempts, funnel linkage state, and quota—plus per-minute counters, event, goal, and funnel step aggregates with 90-day retention, and administrator change history.
  Calling `cleanup` directly deletes up to 10,000 rows per project and table. There is no loop that empties everything at once.
- Receipt, attempt, and funnel linkage expiration remains at 48 hours, 72 hours, and 72 hours, respectively; daily quota expires 72 hours after the end of the UTC date.
- Per-minute counters without rejection records remove minutes older than the preceding 2. Minutes with rejection records are deleted outside the most recent
  7 UTC dates, including today. Event, goal, and funnel step aggregates delete data outside the 90 days including today in the project time zone. Administrator
  change history removes records outside the rolling 90 days under the same per-table row limit. Projects, schemas, and administrator grants are not deleted.

The cursor is stored as `last_project_id` and `revision` in one row (`id=1`) of `retention_cleanup_state`.
A recreated Worker continues after the last processed position and returns to the beginning at the end.
There is no foreign key, so the cursor survives project deletion. A newly added project is processed in the current or next traversal depending on its
position.

Failure of one project does not block others. A failed project also advances the cursor so it is retried on the next traversal.
The cursor update uses revision CAS, so a stale result from overlapping runs cannot move the cursor backward. Duplicate runs reapply
deletion conditions, so retained data is not deleted. An interruption can cause the page before the cursor was saved to be processed again.

## Failures and Observation

If any project fails or the cursor is not advanced because of a CAS conflict, the run processes the remainder and then
fails with a fixed error. Failure to access the project list or cursor database also fails the run.
Logs contain only `runId`, fixed codes, and `attempted`, `completed`, `failed`, and `cursorAdvanced`; they do not include database error
text, project or event IDs, or settings values. `completed` is the number of projects whose call succeeded, not a deleted-row count
or proof that every expired record in those projects was exhausted.

The maximum SQL statement count is 45 per page (2 state + up to 2 list + up to 40 delete/observe + 1 cursor).
For each project it runs the 9 deletes and one remaining expired-receipt MIN query in the same batch. The default one-page run stays within D1 Free's
50-executions-per-run limit. The four-page option can reach 180, so use it only on hosts that support that budget. It checks a successful
cursor CAS on every page and stops reading the next page on conflict. It does not delete in parallel. The optional `clock`, `signal`, and
`maxPages` preserve `runCleanup`'s existing required arguments. Physical deletion can be delayed by traversal and deletion limits or failures even after retention expires.
A delayed run uses the scheduled time and catches up in later runs. Measure expired backlog and database write cost
before adjusting interval or throughput. Do not hide a backlog by changing expiration times themselves.

## Host Activation and Rollback

The host must apply `0002_retention_cleanup.sql` after `0001_initial.sql` and connect the D1 `DB` binding and the Worker's
`scheduled` export. It only adds a new table and does not change existing project or event rows. Applying
`0005_admin_changes.sql` makes the same cleanup delete administrator change history under the same limits. Applying
`0007_task_funnels.sql` also removes funnel linkage state and step aggregates in the same traversal. A remote Cron Trigger has not been registered.
The pilot proposal is a run every minute, adding the following fragment to the production host configuration.

```json
{ "triggers": { "crons": ["* * * * *"] } }
```

To stop cleanup, remove the host Cron Trigger. The new tables can remain after a code rollback without affecting an earlier collector.
Deleted expired data is not restored by a code rollback; follow the separate backup and restore policy if recovery is needed. Remote work runs within the approved deployment scope.

The structure follows [DBML](../../db/schema.dbml), migrations follow the
[application notes](../../db/migrations/README.md), and execution evidence is in [VALIDATION](../../VALIDATION.md).
Host behavior references the [Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
and query budgets reference [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Ingestion-Scaled Deletion Budget and Observation — 2026-10-23

For a run every minute, traversal interval is calculated from the project count and projects processed per run.
The deletion limit per project is `ceil(daily new-receipt limit × traversal minutes × 2 / 1440)`, bounded to
500 to 10,000 rows. The factor of 2 allows for missed scheduled runs and existing backlog.
At 100 projects with a daily limit of 100,000, the value is 3,473 rows per table; at 200 projects it is 6,945.
This value is not a measurement or guarantee of execution throughput. The 20-second cleanup time, 30-second database lifetime, cursor CAS, and
retention period remain unchanged. Paused projects continue to be cleaned.

The new metrics log records deleted rows, the number of tables that reached the deletion limit, the number of measured projects,
the longest delay of expired receipts remaining after deletion, and the number of projects whose calculated requirement exceeded 10,000 rows.
If the last value is present or expired-data delay increases, review ingestion limits, paid-host page counts, and database separation. Do not interpret it
as the longest delay in other tables or overall database backlog. Reprocessing the same project remains forbidden, and the previous void cleanup call
retains its required signature.
