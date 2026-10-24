# Production Installation Configuration Preparation

For the bundled self-hosted provider, follow [Better Auth setup](better-auth.md)
alongside this guide. External OIDC installation remains supported.

Status: The same-origin paths, OIDC client, server verifier, and local configuration tools have been implemented.
The initial Better Auth installation and remote verification completed on 2026-10-25; see [validation evidence](../../VALIDATION.md). Independent installations must supply their own real account, origin, identity and D1 values. The commands below
prepare local files only. They do not automatically perform registration, grant authorization, remote database application, or deployment.

## Interactive Configuration — `install:setup`

```powershell
npm run install:setup -- --out .tmp/installation
```

Run this only in an interactive terminal where `stdin` and `stderr` are TTYs; it asks only for public configuration values. When you enter the
administrator HTTPS origin, it determines on the spot whether that is a workers.dev address or a custom domain, so
`workersDev` and `domain` are not entered separately. The administrator and collector use the same Cloudflare account ID; only the
collector's workers.dev exposure is asked about separately. Enter the D1 name and ID and the issuer, JWKS, audience, algorithm, and
token type to match the actual resources and provider values. For scope, algorithm, and token type, the prompt shows current
implementation defaults as candidates, and you must confirm that they match the provider configuration. If publisher authentication is enabled,
the setup asks separately for the issuer, JWKS, audience, algorithm, and token type. The publisher audience must differ from the administrator API
audience; the issuer and JWKS may use the same provider.

- Questions, guidance, and the preview go to `stderr`; the result JSON goes to `stdout`. A value with the wrong format triggers the same
  question up to three times; after three failures, the command exits without creating files. Format-error messages do not include the entered value.
  The final preview shows the administrator origin, callback, Worker names, issuer, audience, and output path.
- Tokens, passwords, and client secrets are not requested. Account, domain, D1, and provider values are checked only for syntax;
  actual ownership and existence are not verified.
- An existing output directory is rejected before the first question. Writes use the same writer as `install:prepare`,
  with the `wx` flag so existing files are not overwritten.
- The five files are written only after you answer `y` to the final confirmation. Any other answer produces only
  `{prepared:false,cancelled:true,remoteChanges:false}` without creating files.
- Cancellation stops before writing even after confirmation; if writing has started, it deletes only the files written by the current run.
  Only `--help` alone or `--out <new-directory>` is accepted.
- Ctrl+C during questions and end of standard input abort the questions and emit `installation_setup_cancelled`.
  No files have been written at this stage.
- It makes no network requests and does no sign-in, token issuance, authorization lookup, external registration, resource creation, or deployment. For repeatable
  automation, use the existing `install:prepare --file`.

Value validation ultimately belongs to the existing installation verifier, and the operator decides the actual account, domain, D1, and provider values.
After generation, review, build, and checks follow the sections below.

## Preparing Input

Create `.tmp/installation-input.json` filled with real values. Its top-level JSON keys are the following four.

| Key | Value |
| --- | --- |
| `adminOrigin` | The final administrator HTTPS origin. Enter it without a path, query, fragment, port, or trailing `/`. |
| `admin` | The `workerName`, `accountId`, `collectorWorkerName`, `workersDev`, and optional `domain` for the [administrator target](./runtime.md#administrator-worker-deployment-preparation). |
| `collector` | The `workerName`, `accountId`, `databaseName`, `databaseId`, `workersDev`, and `settings` for the [collector target](./runtime.md#deployment-preparation). |
| `login` | The public OIDC client's `issuer`, `clientId`, `scope`, optional `resource`, and `idTokenAlgorithm`. |

`collector.scheduler` optionally selects `cron` (default) or `auth-alarm` when
using the bundled [Better Auth scheduler](better-auth.md#scheduling-without-additional-cron-slots).
The latter requires deploying and activating the auth clock; selecting it alone
does not start cleanup.

`admin.accountId` and `collector.accountId` must be the same, and `admin.collectorWorkerName` must equal
`collector.workerName`. The administrator origin must be the configured custom domain or the actual workers.dev address of that
administrator Worker. The collector requires `ADMIN_AUTH_MODE=oidc`,
`ALLOW_LOCAL_HTTP=false`, an OIDC issuer, an API audience, and a JWKS URI.
`login.issuer` must exactly match the collector's `OIDC_ISSUER`, including the trailing `/`.
The scope must include `openid`. The ID token signature algorithm and access token algorithm are separate
settings. Use the actual values registered with the provider; do not guess them.

The client is a public client without a secret and uses Authorization Code with PKCE (S256). Do not put private keys, tokens, or client secrets in the
input. The configuration is a closed JSON document of 32 KiB or less, and unknown keys are rejected.
The provider decides how `resource` maps to the API audience, so do not assume that the two are identical.
Syntax checks on addresses and IDs do not prove resource ownership or actual existence.

## Generating the Configuration Bundle

```powershell
npm run install:prepare -- --file .tmp/installation-input.json --out .tmp/installation
```

The output directory must be a new path. If it already exists, the command fails without modifying files.
After all validation succeeds, it creates the directory and writes the following files.

| File | Purpose |
| --- | --- |
| `collector.wrangler.json` | The real account, D1, and server OIDC verification configuration. |
| `admin.wrangler.json` | The collector binding in the same account and the administrator route. Asset paths use `admin-assets` in this bundle. |
| `admin-login.json` | Administrator build input containing only public `VITE_OIDC_` settings. |
| `oidc-registration.json` | The exact callback, CORS origins, PKCE, and access-token requirements to register with the provider. |
| `installation.json` | A reproducible snapshot of the validated input. Credentials are not allowed. |

Do not copy server or database settings into frontend environment variables. Do not place the generated directory in a public static
asset directory. Track paths created by this run from the moment file creation begins.
If a write fails or is cancelled, close open files and clean up partial files too, but
do not remove the directory if it contains any other files. Input and raw exception text are not printed to logs.

If validation fails, it returns an `installation_config_failed` error with one `field`
identifying the input item. The value is one of `input`, `admin`, `collector`, `admin.accountId`, `admin.collectorWorkerName`,
`adminOrigin`, `login`, or `login.issuer`; it does not print other input values, URLs, IDs, or internal exceptions.
Failures outside validation, such as file-read, argument, or write errors, use the existing fixed errors and do not include `field`.

## Administrator Build and Upload-Free Checks

```powershell
npm run admin:build-configured -- --dir .tmp/installation
npm run admin:dry-run -- --config .tmp/installation/admin.wrangler.json
npm run collector:dry-run -- --config .tmp/installation/collector.wrangler.json
```

The administrator build validates the input in `installation.json` again and compares the four generated configuration files
again. It refuses to build if only a specific file was edited or the directory was moved and absolute paths changed.
To change values, edit the input and generate a new installation directory.
Only the public login JSON is passed through Vite defines; `.env` and `VITE_` values from the parent process are
not read. Build in production mode and do not apply development proxy settings.
The basis is the [Vite configuration](https://vite.dev/config/shared-options.html) and actual build checks.

Artifacts are written only to the `admin-assets` path in the generated configuration; they do not modify the existing app's `dist/client` or
another installation bundle. Only a new asset directory is allowed, and `admin-build.json` is written after success.
Partial files from a failed build are preserved. Prepare a new installation directory instead of trying to
overwrite an existing or failed build. To use another host, generate the configuration and build again on that host.

`admin:dry-run` passes only the selected configuration to the installed Wrangler and fixes `--dry-run`.
Options other than `--config` and `--outdir`, including duplicate options, are rejected. The default configuration is
for type and package checks. Success confirms local packaging; it is not a result of validating sign-in, DNS, remote bindings, or the
database. Actual deployment is an approved follow-up task.

## Provider and Operational Verification

Using `oidc-registration.json` as the basis, register the public client, callback, and administrator CORS origin with the
provider. Discovery, token, and JWKS endpoints must use HTTPS and support S256. The API must issue a signed JWT access token for the
registered audience, not an ID token. If refresh tokens are used, rotate them; otherwise sign in again after
expiration. Follow the [OIDC Policy](./oidc.md).

After a real sign-in, expand `Check signed-in account` in the administrator screen, read the issuer and subject
verified by the server, and copy the account information JSON. An account can read its own identity even without project authorization.
After a trusted operator verifies the copied identifiers, grant the required creator authorization and administrator grants. Do not infer a subject
from a public client ID, email address, or browser Origin. A trusted operator can register initial creator authorization through the
preview and plan-hash application of the [Remote Creator Authorization Tool](./remote-creator-provisioning.md).
The creation API grants ownership of the first project. The existing CLI that directly registers grants for existing
projects supports local operation only. The first production application also requires remote D1 migrations, scheduled cleanup,
and backup and recovery procedures; distinguish tool implementation from completed remote authorization registration.

The current schema recovery path can be practiced against a new local synthetic database with `npm run verify:restore`.
For actual production backup, remote recovery, and RTO/RPO verification, follow the [Backup and Recovery Procedure](../ops/backup-and-restore.md).

Provider registration, CORS, JWT issuance and refresh, and remote Worker connections have not been verified.
Distinguish completed configuration preparation from completed production sign-in.

## Public Provider Check — `install:check`

```powershell
npm run install:check -- --dir .tmp/installation
```

After validating the five files in the prepared installation directory again, this command GETs the public OIDC discovery document and JWKS.
It sends only a diagnostic OPTIONS request to the token endpoint and omits that request when the endpoint has the same origin.
It performs no sign-in, code exchange, token issuance or refresh, client registration, Cloudflare lookup, database access, deployment, or file write.
If publisher authentication is enabled, it also reads the configured publisher JWKS.

Requests must use HTTPS, and user information in the query, fragment, or address is rejected. They are sent without cookies, authentication headers, or a
referrer, and redirects are not followed. Limits are 5 seconds per request, 45 seconds for the whole CLI, 64 KiB per body, and
32 keys. It checks exact issuer equality, code response support, PKCE S256, and the ID token algorithm, and actually imports the public keys.
RSA keys must be at least 2048 bits, and ES256 keys must use P-256.

Cross-origin discovery and JWKS GET requests require CORS headers allowing the administrator origin or `*`.
Same-origin requests do not require CORS headers. A token OPTIONS result is not evidence of an actual POST or refresh,
and a 405 or failed check is recorded as a nonblocking `unknown`. Separately verify the provider's client, callback, scope, audience, and
token-type settings and the actual sign-in.

`publicChecksPassed` is true only when all required public checks pass.
`operationalReadinessVerified` is always false, and the command also returns a `manualRequired` list.
A failed or unverified required check exits with code 1. It does not print input, response bodies, keys, addresses, or identifiers.
Detailed usage is in the [Installation Check Guide](../../tools/runtime/INSTALL-CHECK.md).
The references are [OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html),
[RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html), and the
[CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

## Remote Schema Metadata Check — `install:database-check`

```powershell
npm run install:database-check -- --remote --dir .tmp/installation
```

This command validates the five files in the prepared installation directory again, applies the baseline migrations to a new
in-memory D1 created by the current run, then queries the remote D1's `sqlite_master` once and compares the names and definitions of tables, indexes, and triggers.
The baseline is the current thirteen migrations from `0001` through `0013` and 16 tables, including publisher history and assigned IDs, grant revisions,
read indexes, and elapsed-time and failure-cause extensions. It reuses the installed Wrangler transport from the existing remote creator authorization tool
as-is and accepts no SQL input, environment variables, or additional configuration options.

The report contains baseline and observed object counts, names of missing or changed objects (baseline objects only), unexpected object counts, the schema
SHA-256, target hash, and baseline migration list. It does not print SQL, addresses, accounts, database IDs, issuers, or subjects.
Even when `databaseSchemaMatches` is true, `operationalReadinessVerified` is false; an unexpected result or a check that cannot be completed exits with code 1.

It performs no remote writes, product-row reads, sign-in token issuance, grant authorization, remote migrations, or deployment.
Schema equality is not a result of verifying data integrity, cleanup Cron, backup, or sign-in.
No production installation bundle exists yet, so actual production database connectivity has not been verified; decide whether it passes after running it remotely.
The query command follows the [D1 Wrangler guide](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute).

## Administrator Access Check — `install:access-check`

```powershell
npm run install:access-check -- --dir .tmp/installation --token-stdin
```

After validating the five files in the prepared installation directory again, this command reads an already-issued administrator access token from
noninteractive standard input and sends only three reads in sequence to the reviewed administrator HTTPS origin.
It checks the issuer verified by the server with `GET /v1/identity`, and only when that issuer exactly matches the configured publisher
does it check that `GET /v1/health` returns `{status:'ok', scope:'administrator_storage_read'}`; finally, it reads
`GET /v1/projects?limit=1`. If an earlier check fails, later checks are not requested.
The token is not retained in arguments, files, reports, or errors.

It rejects redirects, omits credentials, uses no-referrer and no-store, performs no retries, and applies limits of 5 seconds per request,
15 seconds for checks after token input, 30 seconds for standard input, and 16 KiB per body. The report uses schema `tallyfin.install-access-check/v2`
and contains fixed `status` and `code` values in the order `admin-identity`, `admin-storage-read`, and `project-list`,
`accessChecksPassed` (true only when all three checks pass), `visibleProjectObserved` (true, false, or null), and
`operationalReadinessVerified`, `remoteChanges`, and `tokensRequested` (always false).
It does not print raw tokens, names, subjects, URLs, or bodies.

The CLI does not access the database directly. `admin-storage-read` is the administrator Worker's HTTP health response, which means the
server read the two control-plane tables `projects` and `project_grants` in read-only mode. That
success is not a judgment that the entire service is healthy. An empty project list means the API is reachable but does not prove initial
project authorization or creation. An issuer mismatch or failed check skips later reads and does not turn the result into a pass (later checks remain unknown as
`identity-check-required` and `storage-check-required`).
This command performs no sign-in, token issuance or refresh, client registration, remote changes, deployment, or file writes.

After the three-stage extension, 7/7 focused local checks and the root type check (exit code 0) passed. This extension changed only the CLI;
the API, database, and collector code were not changed. Verification records follow [VALIDATION.md](../../VALIDATION.md). Real provider behavior and remote deployment have not been verified.

`install:check`, `install:database-check`, and `install:access-check` separately examine the public provider, remote database
metadata, and administrator read access. None of the three establishes complete operational readiness for sign-in, token refresh, initial owner or creator
authorization, ingestion and Cron, or backup and recovery. Detailed usage is in the
[Access Check Guide](../../tools/runtime/INSTALL-ACCESS-CHECK.md).
