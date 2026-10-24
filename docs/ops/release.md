# Release

Status: documentation-only runbook. No production deployment, remote migration, backup, restoration,
or production sign-in has been performed.

Preparation, builds, and dry runs can create local files without changing remote state. `--help`
only displays usage. Listing or exporting a remote database and running installation checks are read
operations. `wrangler deploy`, `d1 migrations apply --remote`, and `wrangler rollback` change
remote state. Run the remote mutation commands below only against an approved target and scope.

## Release Unit

A release combines the code bundle, the installation bundle (five files), and the database schema.

- Migrations: thirteen migrations, `0001` through `0013`, and 16 application tables. The baseline
  migration head for this document is `0013_workflow_failure_reasons.sql`. The event schema version
  (`schema_version`) is separate from the migration number and is set by the project schema
  publishing flow.
- Installation bundle: the five files `collector.wrangler.json`, `admin.wrangler.json`,
  `admin-login.json`, `oidc-registration.json`, and `installation.json`, created by
  `install:prepare`. In an interactive terminal, `install:setup` creates the same five files with
  the same writer.
- Real provider, account, D1, domain, issuer, audience, client, and resource values do not exist yet.
  Do not invent values; use only real values confirmed by the operator. Syntax validation does not
  prove that a resource is owned or exists.

## Preparation and Offline Checks (No Remote Changes)

Run these commands from the repository root. They assume Node 24 or later and a root lockfile
installation.

```powershell
npm ci --ignore-scripts
npm run install:prepare -- --file .tmp/installation-input.json --out .tmp/installation
npm run admin:build-configured -- --dir .tmp/installation
npm run admin:dry-run -- --config .tmp/installation/admin.wrangler.json
npm run collector:dry-run -- --config .tmp/installation/collector.wrangler.json
```

The output path for `install:prepare` must be new; the command fails if it already exists. To change
values, edit the input and create a new directory. A successful dry run only confirms local
packaging; it does not verify sign-in, DNS, remote bindings, or the database.

In an interactive terminal, `npm run install:setup -- --out <new-directory>` creates the same five
files.

## Three Read Checks (Separate Targets)

The three checks inspect different targets. A pass in one does not mean production is ready.

| Check | Command | What it verifies | What it does not verify |
| --- | --- | --- | --- |
| Public provider | `npm run install:check -- --dir .tmp/installation` | Revalidates the preparation bundle, public OIDC discovery and JWKS, and a diagnostic OPTIONS request to the token endpoint | Actual sign-in, code exchange, token issuance, or client registration |
| Remote database metadata | `npm run install:database-check -- --remote --dir .tmp/installation` | Compares remote `sqlite_master` and the schema defined by `0001` through `0013`. `d1_migrations` is excluded from the comparison | Data integrity, cleanup Cron, backups, or runtime behavior |
| Administrator read access | `npm run install:access-check -- --dir .tmp/installation --token-stdin` | The 3-step gate on the reviewed administrator origin: `GET /v1/identity` → `GET /v1/health` → `GET /v1/projects?limit=1`. `/v1/health` reads `projects` and `project_grants` | Token issuance or refresh, initial owner or creator permissions, collection writes, Cron, or overall storage health |

All three reports set `operationalReadinessVerified` to false. Passing required checks alone does not
allow a readiness declaration. `install:access-check` accepts an already-issued bearer token only
through non-interactive standard input and never leaves the token in arguments, files, reports, or
conversation.

## Handoff Record

- Record the SHA-256 of the five installation files. On Windows, calculate it directly with
  `Get-FileHash -Algorithm SHA256 <file>`. There is no separate gate tool.
- Record the commit hash; the five file names and their SHA-256 values; the migration head; the
  target account, database, Worker, and domain (as hashes instead of source values); and the
  pre-application backup path, time, and hash.
- `install:check`, `install:database-check`, and `install:access-check` revalidate the five files
  before running and reject a bundle that was modified or moved.

## Sequence (Upgrade an Existing Database or Create a New One)

1. Confirm the migration head.
2. For an existing database, stop Cron and related writers, and confirm that in-flight writes have
   drained.
3. In that state, take the pre-application backup and record the target table row counts. Confirm
   that an empty new database is empty.
4. Apply migrations in order. Do not rerun migrations that are already applied.
5. Verify the schema, row counts, and foreign keys. If there is a problem, do not proceed to
   deployment.
6. Deploy the collector.
7. Deploy the administrator.
8. Run post-deployment verification, then resume writers and Cron only after compatibility is
   confirmed. Open restricted general collection after completing validation with the verification
   project.

Every remote command takes the revalidated preparation bundle configuration through `--config`.
The root `wrangler.jsonc` is a type and package baseline; do not use it as the default for remote
commands.

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config .tmp/installation/collector.wrangler.json
node node_modules/wrangler/bin/wrangler.js d1 export DB --remote --output <new-backup.sql> --config .tmp/installation/collector.wrangler.json
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config .tmp/installation/collector.wrangler.json
```

`d1 migrations list` lists unapplied files, not application history. Determine applied history with a
separate check that includes `d1_migrations`. The `d1 migrations apply` help states that only a
failed migration is rolled back; migrations that succeeded earlier remain applied. A partial
application state is possible. The backup that the same help suggests is created after application,
so it is not evidence of a pre-application backup. Create the pre-application backup in advance.
`d1 export <name> --remote` requires `--output`, and `<name>` can use the database binding name.

## Applying Migrations (Empty Database, Upgrade, or Restore)

| Situation | Procedure |
| --- | --- |
| Empty new database | Apply `0001` through `0013` in order. The table-copy targets are empty. |
| Upgrade an existing database | Determine the last applied number first. Do not rerun migrations that are already applied. |
| Restore a full backup SQL dump | Load the full backup SQL into an empty database. Do not apply the same migrations again first. |

For migrations that recreate tables, stop Cron and related writers globally, take a backup, and
compare row counts and the schema before and after application.

| Migration | Recreated target | Writes to stop |
| --- | --- | --- |
| `0006_server_collection.sql` | `event_receipts`, `event_daily_counts` | Browser and server collection, administrator and permission writers, Cron |
| `0008_publisher_history.sql` | `admin_changes` | Administrator API and CLI writes, Cron |
| `0009_publisher_generations.sql` | `project_publishers` | Publisher CLI and HTTP writes, Cron |

`0010_grant_revision.sql` does not modify existing grant rows. It adds `projects.grant_revision`
and grant insert, delete, and role-update triggers in one batch. Apply it before the new API and UI
that send `grantRevision` from an administrator list as `expectedRevision`, and do not use the
old administrator editing screen to change grants. Local initialization rejects a state with only
some triggers or without the revision column.

`0011_analytics_lookup.sql` adds only 2 event and funnel query indexes. It does not change existing
rows, keys, or responses, and index creation scans the existing aggregates. Confirm the
pre-application backup, row counts, and absence of the indexes, then apply both statements in one
batch during a quiet period. After application, verify both definitions, row counts, foreign keys,
and existing query results.

`0012_workflow_duration.sql` adds a 12-slot duration array to `workflow_daily_counts`, and
`0013_workflow_failure_reasons.sql` adds `workflow_attempts.failure_reason_slot` and a 33-slot
failure-reason array. Apply 0012 followed by 0013, then deploy the new Collector and administrator.
Because these migrations are additive, the previous Collector can continue collecting and updating
completed counts using the existing columns it specifies, but it will not record the new duration
or failure-reason measurements. Completions before the transition and past failures remain
unmeasured. After application, verify array lengths, integer and total constraints, the terminal
failure condition for failure slots, foreign keys, and that rerunning the migration makes no
changes.

- Before application: migration head, recreated-target row counts, existence of the
  pre-application backup, and drained in-flight writes.
- After application: whether row counts are equal; whether columns, CHECK constraints, indexes,
  triggers, and foreign keys exist; and whether `PRAGMA foreign_key_check` reports violations.
- Even an environment with only server writes requires a backup and row-integrity checks.
- Stopping only Cron does not stop collection. Pausing a project does not block administrator
  reads and writes or trusted CLI operations. Stop external host ingress and writers together in
  host operations.
- An older reader that does not know the new actions in 0008
  (`publisher.granted` and `publisher.revoked`) is incompatible with the new rows. 0009 requires
  revocation by `grant_id`; the old `expectedCreatedAt` path no longer exists. Administrator lists
  and writes after 0010 must handle `grantRevision` and `expectedRevision` together.

File-level atomicity of remote application has been verified only locally; production execution is
unverified. Do not use ordinary `wrangler d1 migrations apply` as evidence of atomic per-file table
recreation. Remote application is blocked until a procedure approved through rehearsal exists. Run
the actual readiness checks in a separate verification project isolated from the production
database.

## Deployment (Manual, After Approval)

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --config .tmp/installation/collector.wrangler.json --dry-run
node node_modules/wrangler/bin/wrangler.js deploy --config .tmp/installation/collector.wrangler.json
node node_modules/wrangler/bin/wrangler.js deploy --config .tmp/installation/admin.wrangler.json
```

- `wrangler deploy` supports `--dry-run` and `--keep-vars` (default false). Specify
  `--keep-vars` to preserve existing vars. A default deployment deletes ordinary vars that are not
  in the config, so first compare the remote settings with the reviewed config. Do not use this flag
  to retain stale authentication settings unconditionally.
- View the most recent 10 deployment records with
  `wrangler deployments list --config <config> --json`.
- Do not use bypasses such as `--yes` to skip confirmation prompts.
- After deployment, verify routing, domains, and Cron Triggers from a separate inventory.

## Post-Deployment Verification (Required)

- Verify administrator sign-in with the real provider and the token-refresh or re-sign-in path after
  expiration.
- As an owner, read the project list and settings, and verify that a reader receives 403 when
  attempting to read grant lists and publisher lists.
- Verify that access to another project (tenant) is denied.
- In a separate verification project, verify that browser new and duplicate replays and server new
  and duplicate replays each increment aggregates only once.
- Verify that Cron is observed and that the cleanup cursor advances.
- Record the SHA-256 of the five installation files and build assets, and compare them with the
  deployed Worker version ID. Use `install:database-check` to verify the remote schema and
  `install:access-check` to verify administrator read access.

## Stop Conditions

- The preparation bundle differs from the reviewed SHA-256, or a file was modified or moved.
- The migration head is unknown, or local and remote state differ.
- There is no pre-application backup, or recoverability has not been verified.
- Personal information or secrets are exposed in output, logs, or assets.
- An authentication or authorization gate (issuer, audience, PKCE, owner/reader, tenant) fails.
- A required check fails or is unverified.

## Observability

The basis for a release decision is [operational observability](./observability.md). Completion
observations have seven fixed fields: `event`, `requestId`, `operation`, `status`, `code`,
`latencyBucket`, and `samplingDenominator`. Successes are sampled at 1/64, and failures are logged
in full. No dashboard, alert recipient, health probe, or log-retention period has been deployed, and
thresholds and owners are UNDECIDED. Do not create alert recipients that have not been confirmed.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- Required validation names: [VALIDATION.md](../../VALIDATION.md)
- Release blocking status: UNDECIDED
- Remaining operational risk: UNDECIDED
- SLO: UNDECIDED
- The commands and options above are based on installed CLI help and repository documentation. They
  are not evidence of actual remote execution.

## Evidence

- [Cloudflare Workers rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Wrangler deployment commands](https://developers.cloudflare.com/workers/wrangler/commands/)
