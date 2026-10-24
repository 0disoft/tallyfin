# Project Registration and Authorization Management CLI

The `provision` commands on this page are tools for offline operators. They use Node 24 and Miniflare's local persistent
D1 and have no remote mode or user authentication. The separate
[Remote Creator Authorization Tool](./remote-creator-provisioning.md) supports only granting and revoking remote
`project_creators` for a verified installation bundle.

## Commands

```sh
npm run provision -- --help
npm run provision -- init --local --state-dir .tmp/provision-db
npm run provision -- init --local --state-dir .tmp/provision-db --apply
npm run provision -- register --local --state-dir .tmp/provision-db --file api/examples/registry.json
npm run provision -- register --local --state-dir .tmp/provision-db --file api/examples/registry.json --apply
npm run provision -- publisher-grant --local --state-dir .tmp/provision-db --file .tmp/publisher-grant.json
npm run provision -- publisher-revoke --local --state-dir .tmp/provision-db --file .tmp/publisher-revoke.json --apply
```

The default is a preview. Data is written only when `--apply` is supplied.

- `--state-dir`: Directory containing the D1 file. Place it in a path that Git does not track.
- `--file`: Input JSON path. The file is 64 KiB or less, and unknown fields are rejected.
- `--expect-plan`: Checks that the current input and database snapshot match the planHash received from preview. It can be used only with `--apply` and cannot be used with `init`.
- `--allow-local-http`: Allows only local loopback browser origins. The issuer must still use HTTPS.

A preview opens the state directory and creates persistent D1 storage but does not write projects, schemas, or grants.

## init

`init --apply` applies the not-yet-applied migrations from the repository's 13 migrations, `0001_initial.sql` through `0013_workflow_failure_reasons.sql`, to the local database. It identifies 0006 by the existence of `project_publishers` rather than by recreating a table; 0008 by the extended action; and 0009 by the 32-character hex `grant_id`, UNIQUE and CHECK constraints, and `immutable_publisher_generation` trigger. It also checks grant revision columns and triggers from 0010, two read indexes from 0011, and duration and failure-reason columns and constraints from 0012 and 0013. If intermediate tables from a recreation or a partially applied column, constraint, index, or trigger exists, it stops with `partial_database`. If there are no migrations to apply, it makes no changes.

Initialization, storage test fixtures, and restore drills use the reviewed list in
`tools/provision/migrations.ts`. If the SQL names in the directory and list differ, it stops before querying or applying to the database.
Rules for registering new SQL and splitting statements are in the [migration catalog guide](../../db/migrations/README.md).

## register

This command accepts the [registry.json](../../api/examples/registry.json) shape. It requires an initialized database. It changes the project name, status, origins, and limits and supports active and retired schemas. The time zone and an already published schema definition cannot be changed, and a new version must be greater than the existing maximum version.

## grant / revoke

The grant JSON contains `projectId`, `issuer`, `subject`, and `role` (`reader` or `owner`). The revoke JSON contains `projectId`, `issuer`, and `subject`. Use issuer and subject values actually confirmed by the configured OIDC provider. Do not invent them.

This tool does not check user sign-in. A reader or owner grant in D1 permits administrator reads; it is not permission to access the CLI. Registering the first owner is allowed, while removing or demoting the last owner is blocked. The authorization model is detailed in [02-authorization.md](./02-authorization.md).

## Concurrency and Application

### creator-grant / creator-revoke

Project creation authorization is separate from project ownership and is granted by an operator. `creator-grant` JSON
accepts the actually confirmed `issuer`, `subject`, and `maxProjects` (1 to 1000). `creator-revoke` accepts only
`issuer` and `subject`. The `--local`, `--file`, preview, `--expect-plan`, and `--apply` behavior matches existing grant commands.
The output contains a `principalHash` instead of the raw issuer and subject.
Creation authorization and the creation count are compared immediately before application, and revocation does not delete existing project grants or
creation history. Lowering the limit to the current usage count blocks only further creation.

### publisher-grant / publisher-revoke

Server publishing authorization (`project_publishers`) is separate from administrator authorization and is granted and revoked by an operator.
The JSON accepts only `projectId`, `issuer`, and `subject`; it does not accept a role or project limit.
Issuer and subject formats are checked with the core `validGrantIdentity`. If the project is not in the database,
preview stops with `project_not_found`.

- This command inserts and deletes only `project_publishers` rows. It neither touches administrator `project_grants`
  nor checks the last owner. It does not issue credentials or tokens or grant an administrator role.
- Immediately before application it compares the project creation time (`created_at`) and the current publishing row's `grant_id` with CAS.
  `grant_id` is not a credential; it is a nonsecret marker that distinguishes revocation and re-grant, and a new value is assigned after a delete and grant even within
  the same millisecond. If the desired state already exists, the operation is a no-op (zero changes) and does not rewrite the existing row. If the snapshot's `grant_id` changes in the meantime
  and the revoking DELETE affects zero rows, the result is `apply_conflict` and nothing is written.
- If the apply SQL itself fails, the result is `database_unavailable`. Because application is then unconfirmed,
  do not assert that it rolled back; inspect the database and run preview again.
- The `--local`, `--file` (64 KiB), preview, `--expect-plan`, and `--apply` behavior matches existing commands.
- Plan output contains `operation`, `projectId`, `principalHash` (SHA-256 of canonical `[issuer, subject]`),
  `granted`, `changes` (`target: publisher`, `field: granted`, before and after), and
  `planHash`. Raw issuer and subject values are not included in output. The output hash is for comparison and is not encryption.
  A plan is kept only in a WeakMap inside the tool instance and is deleted on application, so only a plan created in the same process can be applied.
- A real publishing authorization change is recorded in the administrator change history (`admin_changes`) in the same D1 batch as
  `publisher.granted` or `publisher.revoked`. The actor for a trusted CLI operation is empty, and the target issuer and subject are recorded.
  A no-op adds no history.
- Migration 0009 recreates `project_publishers` and adds `grant_id`. Because the table cannot be updated directly, revocation deletes and granting reinserts.

### Concurrency in register / grant / revoke

The modifying SQL for these three commands runs in one transactional D1 batch and rolls back on conflict. Before application, it checks the ingest revision and schema and grant snapshots with CAS. A no-op plan also rechecks the snapshot. Plans contain a hashed principal instead of issuer and subject. planHash compares input with the database snapshot. The output hash is for comparison and is not encryption. Concurrent ingestion can invalidate a plan, so run preview again. Publisher CLI concurrency and failure handling follow the separate section above.

## Rollback

Published schemas cannot be changed. There is no project deletion or destructive rollback command. To roll back, reapply the previous project name, status, allowed origins, limits, and schema status, and restore grants to their previous roles. Back up the entire local state while the tool is stopped before writing.

## Error Codes

- `invalid_input`: The JSON format or a field does not follow the rules.
- `project_not_found`: The project for which publishing authorization is being granted or revoked is not in the database.
- `immutable_timezone`: An attempt was made to change the time zone.
- `immutable_schema`: An attempt was made to change a published schema definition.
- `invalid_version`: The new version is not greater than the existing maximum version.
- `last_owner`: An attempt was made to remove or demote the last owner.
- `apply_conflict`: The snapshot differs from preview, so application was cancelled. For `register`, `grant`, and `revoke`,
  a batch write failure also rolls back with this code, while the publisher CLI uses it only for a snapshot conflict.
- `plan_changed`: The snapshot differs from preview.
- `database_unavailable`: The local D1 could not be opened or its state could not be read. Apply SQL failures also use this code,
  and in that case application is unconfirmed. Check initialization, paths, and database state.
