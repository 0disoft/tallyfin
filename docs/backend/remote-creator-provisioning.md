# Remote Project Creator Authorization Registration

This is a tool for a trusted database operator to grant, change, or revoke the creator authorization of the first administrator account.
It is separate from the local registration CLI and changes only `project_creators`. It does not change project reader or owner grants,
server publishing authorization, creation history, administrator change history, schemas, or credentials.

## Preparation

- Prepare the [installation configuration bundle](./installation.md) and apply the existing migrations to the target remote D1.
  This tool does not create a database or tables.
- Have existing Wrangler authentication in the operator environment that can read and edit that account and database.
  Do not put token values in command arguments or input JSON. Provider registration and sign-in are not performed automatically.
- After a real administrator sign-in, copy the issuer and subject verified by the server from `Check signed-in account`.
  The operator compares them with the real account before use. Do not infer a subject from an email address, public client ID, or Origin.
- Put the two copied fields and the allowed `maxProjects` (1 to 1000) in an input file that Git does not track.
  Revocation input contains only issuer and subject. Unknown fields, a different installation issuer, and invalid characters are rejected.

## Preview and Application

```powershell
npm run provision:remote-creators -- --help
npm run provision:remote-creators -- creator-grant --remote --dir .tmp/installation --file .tmp/creator-grant.json
npm run provision:remote-creators -- creator-grant --remote --dir .tmp/installation --file .tmp/creator-grant.json --apply --expect-plan <preview-planHash>
npm run provision:remote-creators -- creator-revoke --remote --dir .tmp/installation --file .tmp/creator-revoke.json
```

The default preview also **reads the remote database**. Review the account ID, database ID, database name, collector name,
principalHash, current limit, creation count, and before/after limits in the output. The real write occurs only when
`--apply --expect-plan` are supplied together. Revocation is also applied after preview in the same way.

It validates the installation snapshot and the four generated configuration files again. It accepts no arbitrary Wrangler configuration, environment selection, SQL,
profile, login, or migration options. The account, database, collector, issuer, input, and database state are included in
the plan hash, so an earlier hash cannot be applied to another target or a changed state.
Output contains no raw issuer or subject or tokens, and the hash is not encryption.

Application is a single SQL write whose condition includes the authorization limit, authorization creation time, and creation count. If the condition changes,
it stops with `apply_conflict`. A limit change preserves the original grant time, and the same state is a no-op.
Revocation leaves existing project authorization and creation history. Lowering the limit to the current usage count blocks only
further creation. When the first project is created, the existing creation API stores that account's first owner with the project.

## Execution Boundary and Failure Handling

It runs one query at a time with the installed Wrangler's `d1 execute --remote --json --command`.
It does not use the database import path of SQL file execution. Evidence for the checked CLI behavior is the
[D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute) documentation,
the installed Wrangler source, and local execution checks.

It uses temporary configuration and an empty env file containing only the selected account and database. It disables
parent API address, account, and environment overrides plus separate output files, log files, and usage and error telemetry.
SQL is constructed internally, and identifiers are inserted as UTF-8 hex literals separate from SQL syntax.
This encoding is not secret storage; Cloudflare, which receives the SQL, and the local process inspector can decode the identifiers.
Bearer and Cloudflare tokens are not placed in SQL or command arguments.
The installed CLI entry is invoked directly with a 30-second limit. It verifies that the temporary path is a subdirectory created by this run,
then cleans up the Wrangler cache too.

- `invalid_arguments` / `invalid_input`: Correct the command options or input format.
- `invalid_target` / `issuer_mismatch`: Recheck the installation bundle and real administrator account.
- `plan_changed` / `apply_conflict`: Read a new preview and review the change again.
- `database_unavailable`: Check authentication, tables, and the response. The write may already have been applied.
  It does not resend automatically; inspect the current limit with a new preview before proceeding.
- `cleanup_failed`: The temporary directory must be cleaned up independently of whether the database write was applied.

Current evidence is local D1 SQL verification, a synthetic remote transport, and local execution of the real Wrangler.
A real production account, remote database, sign-in, and authorization application have not been verified.
