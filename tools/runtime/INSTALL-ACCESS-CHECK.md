# Administrator Access Check — `install:access-check`

```powershell
npm run install:access-check -- --dir <prepared-installation> --token-stdin
```

The command first revalidates the five files in the installation bundle created by `install:prepare`.
It rejects modified files, moved bundles, and unknown options before reading standard input. It
supports only `--dir`, `--token-stdin`, and `--help`.

The token is read only from non-interactive standard input. It is never retained in arguments,
files, reports, or diagnostic exceptions. The operator's existing safe token source must be
connected to standard input. If stdin is a terminal (TTY), the command rejects it; if it does not
receive one line of at most 8192 bytes within 30 seconds, it fails. One trailing newline is ignored.
Do not paste the token into conversation, create a token file, or put it on the command line. The
operator's existing token source supplies the pipe. The command above does not create a pipe itself,
so connect standard input to the operator's source before running it.

After validating the preparation bundle, the command sends only 3 GET requests in order to the
reviewed administrator HTTPS origin. `GET /v1/identity` verifies that the server-verified issuer
exactly matches the configured issuer, `GET /v1/health` checks for
`{status:'ok', scope:'administrator_storage_read'}`, and then the command reads
`GET /v1/projects?limit=1`. If an earlier check fails, later checks are not requested. It enforces
the same origin, HTTPS, redirect rejection, omitted credentials, no-referrer, no-store, and no
retries. Each request has a 5-second limit, checks have a 15-second limit after token input, and
response bodies are capped at 16 KiB. If transport ignores cancellation, the wait still ends, and
response-stream cleanup does not delay the HTTP verdict or completion of cancellation.

The CLI does not access the database itself. `admin-storage-read` is the result of asking the
administrator Worker over HTTP, and means the server confirmed read-only access to the
`projects` and `project_grants` control-plane tables. That success covers reads of 2 control tables
and is not an overall service-health verdict.

The output is `tallyfin.install-access-check/v2` JSON. `checks` are ordered
`admin-identity`, `admin-storage-read`, and `project-list`; each entry contains only a fixed
`id`, `status(pass|fail|unknown)`, and `code`. `accessChecksPassed` is true only when all 3 checks
pass, and the exit code is then 0. `visibleProjectObserved` is true when one project was read,
false when the list was empty, and null when no project query was made.
`operationalReadinessVerified`, `remoteChanges`, and `tokensRequested` are always false, and
`manualRequired` lists follow-up checks. The command does not output raw tokens, account names,
subjects, URLs, response bodies, or raw error text.

An empty project list means the API is reachable, but does not prove initial project permission or
creation. A different issuer ends with `identity-issuer-mismatch`. If the identity check does not
pass, `admin-storage-read` and `project-list` remain side by side as
`identity-check-required` unknown, and no further requests are made. If only the health check
fails, `project-list` remains `storage-check-required` unknown and no further request is made.
Extra fields, source text, or a different scope in the health response produce the failure
`api-response-invalid`. Network absence, malformed responses, and audience rejection are not turned
into passes. A 401 is `administrator-authentication-rejected`, a 403 is
`administrator-access-rejected`, and any other HTTP status is
`api-http-response-unverified`.

The check does not perform sign-in, code exchange, token issuance or refresh, client registration,
Cloudflare queries, direct database access from the CLI, grant assignment, deployment, or file
writes. It does not replace real browser sign-in, token refresh, initial owner or creator
permissions, collection and Cron, or backup and restore.

After the 3-step extension, 7/7 local focused checks passed, root `npm exec -- tsc --noEmit`
exited with code 0, and `--help` output was checked. Local workerd on Windows emitted 2
`WSARecv` #64 warnings to stderr, but all checks passed; the command succeeded and the database was
confirmed unchanged before and after the check. This extension changed only the CLI, not the API,
database, or collector code. A real provider and remote deployment are still absent. Follow
[VALIDATION.md](../../VALIDATION.md) for the validation record and the
[installation guide](../../docs/backend/installation.md) for supporting details.
