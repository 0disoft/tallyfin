# Backup and Restore

Status: a local synthetic-data recovery drill for all current migrations has been implemented and
verified. Production database backups, remote restoration, failover, and production RTO/RPO have not
been verified. A database operator who manages the installation performs these tasks, and the actual
owners, cadence, retention period, and RTO/RPO targets will be set after operational resources are
assigned (UNDECIDED).

## Local Recovery Drill

```powershell
npm run verify:restore -- --help
npm run verify:restore
```

Each run creates a separate new local database under `.tmp/restore-drill/run-*`. It never opens an
existing development database, production database, or user backup, and it accepts no remote,
target, or file options. The full drill is not part of the default CI run; run it explicitly when
needed.

The current drill stores browser workflows, the four-stage mixed-source funnel, administrator and
publishing permissions with their generation IDs, creation history, administrator history,
receipts, usage and rejection data, and cleanup cursors for migrations 0001 through 0013. It also
includes the permission revision from 0010, the duration buckets from 0012, and the failure-reason
slots from 0013. It covers runs where the final funnel stage arrives first and the maximum safe
integer counters. After closing the database, the drill exports all SQL with the real Wrangler
`d1 export --local` command and restores it into a separate new database with
`d1 execute --local --file`.

The restore check verifies the following:

- All 16 application tables are non-empty, and every row has the same content hash and count.
- The schema hashes for tables, indexes, and triggers match. Only the physical row order and
  whitespace outside SQL quotes are excluded from the comparison; whitespace inside string values
  is compared exactly.
- `PRAGMA quick_check` returns `ok`, and `PRAGMA foreign_key_check` reports no violations.
- Replaying browser and server events does not create new aggregates.
- The database rejects schema-definition and history changes, invalid funnel totals, and
  `UPDATE` statements against administrator history or publisher permission generations, while
  leaving the data unchanged.

The extended recovery drill inserts 20-second successful attempts and 3-second failed attempts as
measurement data and checks that the aggregates are preserved, that the ordering where termination
arrives first for `error=range` is preserved, and that administrator workflow queries return the
same results from the restored database and after replay on a real local D1 database. Results from
7c2fab8 are in `.tmp/restore-drill/run-oIKTrh/report.json`. This is synthetic local verification,
not evidence of production recovery time, RTO, or remote failover.

After completing the restore comparison, the drill exercises publishing permission revocation and
regrant only against the synthetic restored database. It applies the real `publisher-revoke` and
`publisher-grant` commands and verifies that a new non-funnel server event after revocation is
rejected as `forbidden` without changing the database; that regranting in the same millisecond
changes `grant_id` while keeping `created_at`; that a stale revocation plan captured before the
revocation is rejected as `apply_conflict` without changing data or audit records; and that a no-op
grant for an already-desired state creates no audit row. The real revocation and regrant add exactly
2 audit rows: 1 for the revocation and 1 for the regrant. The same event is stored after
the regrant with `accepted=1` and `duplicates=0`. These mutations apply only to the synthetic
restored database; the source backup SQL and source database remain unchanged. Record the execution
results in the [validation record](../../VALIDATION.md).

The evidence is [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/),
[supported PRAGMAs](https://developers.cloudflare.com/d1/sql-api/sql-statements/#pragma-quick_check),
and local execution with the installed CLI. This D1 environment does not allow `integrity_check`,
so the drill uses `quick_check` together with separate content, schema, and constraint checks.

`report.json` records the execution version, migration file hashes, SQL size and hash, per-table
content hashes and row counts, replay and inspection results, and elapsed time. Publisher-exercise
results contain only fixed booleans in `publisherRecovery` and the `addedAuditRows` count; they
do not include identifiers such as subject, issuer, or grantId. The restore fingerprint captured
before the publisher mutation remains unchanged in the `restored` entry. The report never includes
source rows or authentication tokens. `backup.sql` and both databases remain available for
investigation. Only public example and synthetic accounts are used. Failures produce a non-zero exit
code and `failure.json`; content mismatches produce `mismatch.json`. Every owned Miniflare instance
is closed after success or failure.

## Preparing a Production Backup

Compare the target account, database ID, collector, and migration state with the
[installation bundle](../backend/installation.md). A production backup is a separately approved
operation. The following example is a **remote** export and differs from the local drill command.

```powershell
node node_modules/wrangler/bin/wrangler.js d1 export DB --config .tmp/installation/collector.wrangler.json --remote --output <new-backup-SQL-path>
```

A SQL export can block other database requests. Choose a maintenance window, stop collection
writes, and confirm that in-flight writes have completed. Consider administrator reads and server
SDK submissions as well. Record the account and database ID, backup time, code and migration
version, file hash, and the scope of the collection pause. A generated file is not by itself a
recoverable backup.

The maximum-safe-integer preservation of the current counters has been verified locally; other
int64 schemas have not been verified.

Production SQL contains administrator identifiers and product aggregates. Store it in a separate,
access-controlled, encrypted location, and keep it out of public repositories, static assets, and
logs. Manage authentication-provider settings, Worker configuration, and deployment credentials
separately from the SQL backup.

## Production Recovery Sequence

1. Determine the scope of the incident and the time of the latest backup, then stop collection and
   configuration writes.
2. Preserve the source and prepare a separate new database and a recovery environment with
   restricted access.
3. Verify the backup's code and migration version and the SQL hash. When restoring a full schema
   SQL dump into an empty database, do not apply the same migrations again first.
4. Restore the SQL and check the schema, row content and counts, foreign keys, integer values, and
   immutability and funnel constraints. Do not restore only selected projects, permissions,
   receipts, workflows, funnels, usage data, or cleanup cursors.
5. In the recovery environment, verify real OIDC, owner and reader access, permission revocation,
   new events, duplicate replay, and cleanup. Do not send test events to the source service.
6. Review the data-loss scope, recovery time, new database target, and traffic-cutover plan before
   switching traffic.

The current tooling verifies only synthetic local databases. It does not automatically restore
user-provided production backups or switch remote traffic. Separate exercises and timing
measurements are required for the real database size, region, network, and concurrent collection.
A few seconds of local measurement is not evidence of a production RTO. Recovery can undo changes
to receipts, permissions, and aggregates made after the backup, so verify replay and revocation
state afterward.
