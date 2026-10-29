# Rollback

Status: code rollback and whole-service failover remain unverified. A one-off encrypted remote D1
backup/restore is recorded in [current state](../validation/2026-10-29-current-state.md).
A remote `rollback`, restoration, or traffic switch changes remote state. A remote export
reads the database and creates a local SQL file. Execute changes only against an approved target and
scope.

## Decision Tree

1. First determine whether the failure is confined to code or also affects database data.
2. Return to the previous code only when code, API, and database compatibility has been verified,
   and leave the database in place.
3. There is no down migration for reverting a schema. Prefer fixing the problem forward.
4. Restoring an existing database from a backup is not a code rollback. Restoring a new database is
   a separately approved operation.

## Worker Rollback

`wrangler rollback [version-id]` rolls back the Worker code and the configuration included in that
version (bindings and vars). It does not roll back D1 data or schema.

```powershell
node node_modules/wrangler/bin/wrangler.js deployments list --config .tmp/installation/collector.wrangler.json --json
node node_modules/wrangler/bin/wrangler.js rollback <version-id> --config .tmp/installation/collector.wrangler.json
```

- Rollback takes a Worker version ID, not a deployment ID. Use only a value confirmed from the most
  recent 10 records in `deployments list`.
- Pass the revalidated preparation bundle configuration through `--config`; do not use the root
  `wrangler.jsonc`.
- Rollback can be blocked when a referenced binding resource has been deleted. First verify that D1
  and service bindings are still present.
- Verify routing, domains, and Cron Triggers from a separate inventory. Do not assume a version
  rollback restored those settings; restore them separately if needed.
- If only the administrator is affected, perform the same procedure with the reviewed administrator
  config and version ID. Collector and administrator versions are independent, so verify API and
  asset compatibility and keep the database in place.
- After rollback, repeat the
  [release post-deployment verification](./release.md#post-deployment-verification-required) and resume writes after
  the errors are resolved. If the versions are incompatible, keep writes stopped and fix the
  problem forward.

## Migration-Specific Rollback Risks

Preserve the schema when returning to previous code. Do not roll back if older readers or writers
cannot interpret the new schema.

| Migration | Risk when rolling back | Decision |
| --- | --- | --- |
| `0006_server_collection.sql` | If the previous browser code does not recognize the source filter and server support, it can conflict with the extended CHECK constraint and stored server rows | Confirm the previous code's source handling before reuse. Retain the extended table, server rows, and publishing permissions |
| `0008_publisher_history.sql` | An older administrator history reader does not know the new actions | Do not roll back to an older reader. Keep a reader that understands the actions |
| `0009_publisher_generations.sql` | The previous CLI's `createdAt` CAS revocation can delete a regrant made in the same millisecond | Block the old publisher writer. Keep the code that revokes by `grant_id` |
| `0009` + administrator UI | A `DELETE` from the old UI using `expectedCreatedAt` returns 400 behind the new API | Match the assets and API. Do not deploy only the old assets |
| `0010_grant_revision.sql` | If the previous administrator or CLI does not send or cannot read `grant_revision` and `expectedRevision`, grant writes are rejected or incompatible | Keep the revision column and the three triggers. Keep the new administrator and API, and block the old grant writer |
| `0011_analytics_lookup.sql` | Dropping the indexes can change query plans and latency, and recreating them rescans existing aggregates | Keep the indexes. When space must be reclaimed, drop both indexes in one batch and restore them by reapplying 0011 |
| `0012_workflow_duration.sql` | The previous Collector still works but does not aggregate duration for new completions, so the number of unmeasured events increases | Keep the column. Do not calculate or backfill durations for earlier completions |
| `0013_workflow_failure_reasons.sql` | The previous Collector does not write the new failure-reason slots, so the number of unmeasured failures increases | Keep the column. Do not infer past failure reasons; fix the new Collector going forward |

There is no compatibility path for publisher revocation. The new UI uses `grantId` CAS, and old
`expectedCreatedAt` requests are rejected with 400.

## Stopping Writes Before Rollback

- A code rollback still means putting writers back on the new schema. Do not resume writes until the
  previous code is confirmed compatible with the regenerated tables (0008 `admin_changes` and 0009
  `project_publishers`).
- Globally stop Cron and related writers during a table-recreation interval. Even server-only writes
  require a backup and row-integrity checks.
- After 0010 is applied, keep the grant-edit path aligned with the new revision contract. Code for
  0012 and 0013 can be rolled back while retaining the columns, but new measurements will not
  increase. The 0011 indexes are not part of a code rollback.
- Stopping only Cron does not stop collection. Pausing a project does not block administrator reads
  and writes or trusted CLI operations. Stop external host ingress and writers together in host
  operations.

## Database Restore (Separate Approval)

- Do not overwrite an existing database with a backup. Restore only into a new database with
  restricted access.
- Restoration rolls back receipts, permission revocations, aggregates, and audit changes made after
  the backup. Revocations, regrants, and audit records created after the backup time disappear.
- When loading a full backup SQL dump into an empty database, do not apply the same migrations again
  first.
- After restoration, verify row content and counts, schema and foreign keys, `PRAGMA quick_check`,
  and `foreign_key_check`; then verify revocation, regrant, and duplicate replay in the recovery
  environment.
- Review the scope of loss, recovery time, new target, and cutover plan before switching traffic.
- Run actual readiness checks in a separate verification project isolated from the production
  database.
- Follow [backup and restore](./backup-and-restore.md) for detailed commands.

## Stop Conditions

- Compatibility among the rollback target's code, API, and database has not been verified.
- The migration head state is unknown.
- A database restore is needed, but no pre-application backup exists or recoverability has not been
  verified.
- Older readers or writers cannot interpret the new schema or new actions.
- A binding resource required by the rollback has been deleted.
- Personal information or secrets have been exposed.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- Required validation names: [VALIDATION.md](../../VALIDATION.md)
- Release blocking status: UNDECIDED
- Remaining operational risk: UNDECIDED

## Evidence

- [Cloudflare Workers rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
