# Collector Runtime and Deployment Preparation

## Prerequisites

- This is a native Worker and D1 architecture based on Node 24.
- The compatibility date remains 2026-08-06, the existing verification baseline.
- Wrangler is a local dependency on `^4`, with version 4.148.0 installed.
- The initial deployment was verified on 2026-10-25 with Better Auth and separate D1s; see [validation evidence](../../VALIDATION.md). The local preparation commands below do not perform deployment themselves.

## Local Execution

Run these commands from the repository root.

```
npm run provision -- init --local --state-dir .tmp/collector-db --apply
npm run provision -- register --local --state-dir .tmp/collector-db --file api/examples/registry.json --apply
npm run collector:dev -- --local --state-dir .tmp/collector-db
```

- Optional flags are `--port` (default 5188) and `--settings .tmp/collector-settings.json`.
- The local collector and registration CLI use the same state directory and database identifier.
- The server binds only to 127.0.0.1.
- Before completing startup, verify the initialized database and runtime settings. The development server does not apply migrations.
- Administrator and publisher authentication are disabled by default, so both the administrator API and `POST /v1/projects/{projectId}/server-batches` return 401.
- Ctrl+C shuts down scheduled timers, the server, and the runtime. Restart after changing code or settings. Automatic reload is not supported.
- Local cleanup calls the real scheduled handler every 60 seconds. Cleanup runs in the same process do not overlap, and close waits for cleanup in progress.

## Integrated Development Run

`npm run dev` at the repository root runs the collector and the `apps/admin` administrator app together.
It requires Node 24 or later and installs workspace dependencies from the root lockfile. Complete database initialization and
project registration first with the [registration CLI](./provisioning.md). The development run does not
automatically perform migrations, registration, or grant authorization.

```powershell
npm ci --ignore-scripts
npm run provision -- init --local --state-dir .tmp/collector-db --apply
npm run provision -- register --local --state-dir .tmp/collector-db --file api/examples/registry.json --apply
npm run dev -- --local --state-dir .tmp/collector-db

# When the default ports are in use
npm run dev -- --local --state-dir .tmp/collector-db --admin-port 5190 --collector-port 5198
```

The default addresses are `http://127.0.0.1:5180` for the administrator and `http://127.0.0.1:5188` for the collector.
`--settings` accepts the same flat JSON settings as collector execution above. The two ports must be
different. A port in use is treated as an error, and the process does not terminate other processes.
The integrated ready message is printed only after both servers are ready.

On Ctrl+C, SIGTERM, loss of the parent IPC connection, startup failure, or unexpected child exit,
the launcher cleans up the two children it created. It first sends a termination IPC message and, after 10 seconds,
forces any remaining child to stop. On Windows, it terminates only that child tree.
The frontend supports HMR, while changes to collector code or settings require a full restart.

Only `/v1` and its subpaths on the administrator server are forwarded to the collector. Path, query, and headers are
preserved, and `changeOrigin` is false. `/auth/callback` and `/v10` are not proxy targets
and are handled by the administrator SPA. The configuration lives in `apps/admin/vite.config.mjs` and
`apps/admin/scripts/local-proxy.mjs`.

Running the administrator prototype separately still uses the default proxy target `http://127.0.0.1:5188`.
Set the server environment variable `TALLYFIN_COLLECTOR_ORIGIN` to use another port.
Only an explicit HTTP `127.0.0.1` origin is allowed; remote addresses, credentials, paths, queries,
and fragments are rejected. Do not create this setting from a browser-visible `VITE_` variable.

The 401 returned by the administrator API with the default settings is the real collector's authentication response.
Signing in requires a real identity provider configuration and local administrator grants.
Client `VITE_OIDC_` settings live separately in `apps/admin/.env`, and the callback address to register is
`/auth/callback` on the selected administrator origin.
Follow the [OIDC connection guide](./oidc.md#browser-administrator-sign-in).
Real provider sign-in and remote execution have not been verified.

## Configuration File

- JSON is a flat settings object with no nesting. Only known keys are accepted, and defaults are applied to missing values.
- `ADMIN_AUTH_MODE` must explicitly be `disabled` or `oidc`. `ALLOW_LOCAL_HTTP` is the string `"true"` or `"false"` and defaults to false.
- OIDC: `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URI` are required when the mode is `oidc`. The issuer must be an exact HTTPS URL.
- `OIDC_ALGORITHMS` is comma-separated, defaults to `RS256`, permits `RS256,ES256`, and rejects duplicates.
- `OIDC_TOKEN_TYPE` is either `at+jwt` or `JWT`.
- `OIDC_CLOCK_TOLERANCE_SECONDS` is a string integer from 0 through 60 and defaults to 5.
- If the mode is disabled but issuer, audience, or JWKS is nonempty, validation fails. The same rule applies to both administrator and publisher authentication.
- The publisher uses `PUBLISHER_AUTH_MODE` (`disabled` by default, or `oidc`) and `PUBLISHER_OIDC_ISSUER`, `PUBLISHER_OIDC_AUDIENCE`, `PUBLISHER_OIDC_JWKS_URI`, `PUBLISHER_OIDC_ALGORITHMS`, `PUBLISHER_OIDC_TOKEN_TYPE`, and `PUBLISHER_OIDC_CLOCK_TOLERANCE_SECONDS` with the same validation rules as the administrator.
- Existing deployments without publisher keys are treated as having the default `disabled` mode, and the server route remains closed even without a migration.
- If both administrator and publisher modes are `oidc`, their audiences must differ; equal audiences are a static configuration error. The publisher verifier does not reuse the administrator verifier. If the administrator is `disabled` and only the publisher is `oidc`, the Worker serves publisher traffic while administrator routes remain closed with 401.
- Publisher authentication uses the same OIDC adapter as the administrator. The actual provider and the issuer, audience, and JWKS values are **UNDECIDED**. The endpoint, publisher verifier, and runtime setting keys have been implemented locally and passed focused verification; the full check history is in [VALIDATION.md](../../VALIDATION.md).
- Unknown modes, invalid flags, and incomplete configurations are rejected as static errors. Raw settings and tokens are not exposed.
- `configureCollector` validates keys without looking them up. A deployed Worker validates env on its first fetch or scheduled invocation and reuses the verifier cache for the same configuration.
- The database binding is required.
- The auth setting `allowLocalHTTP` applies only to registered browser origins. OIDC endpoints still require HTTPS.
- Using the example registry as-is does not permit localHTTP. Change the origin explicitly and add `provision --allow-local-http` if needed.
- Do not invent real credentials or resource IDs.

## Deployment Preparation

To prepare administrator, collector, and login configuration together, use
`install:prepare` from [Production Installation Configuration](./installation.md). The commands below are alternatives for preparing each Worker's configuration individually.

```
npm run collector:config -- --file .tmp/collector-target.json --out .tmp/collector-deploy/wrangler.json
```

- The input fields are `workerName`, `accountId`, `databaseName`, `databaseId`, `workersDev` (an explicit boolean), `settings` (an object), and optional `browserIngestLimit`.
- The operator supplies the real IDs. Syntax validation does not prove ownership or existence.
- The settings must have `ADMIN_AUTH_MODE` set to `oidc` and `ALLOW_LOCAL_HTTP` set to false. To enable publisher authentication, set `PUBLISHER_AUTH_MODE` to `oidc` and include the publisher OIDC values; the two audiences must differ. Without publisher keys, the server route is deployed closed.
- Secrets and tokens are not accepted, and only known keys are allowed. Input is 8 KiB or less; only a new output path is allowed, and overwriting an existing file is rejected.
- The resulting configuration pins the real account and database ID and uses absolute entry and migration paths. A separate file per target avoids binding confusion from environment inheritance.
- `workers_dev` follows the explicit `workersDev` value, `previewURLs` is false, and crons is `["* * * * *"]`.
- The root `wrangler.jsonc` has no real IDs and is for type and package checks. Do not deploy it directly, because automatic provisioning may occur.
- `npm run collector:dry-run` checks the default bundle and does not upload.
- Check prepared files with `npm run collector:dry-run -- --config .tmp/collector-deploy/wrangler.json`. The operator must supply the real configuration; it was not run in this session.
- Actual deployment, remote migration, project registration, grant authorization, identity provider connection, domain connection, and production verification are approved follow-up work. The registration CLI supports local operation only.

### Optional Browser Ingress Limiter

`browserIngestLimit` adds a Cloudflare Rate Limiting binding for browser ingestion. These EXAMPLE values are not production defaults:

```json
{
  "browserIngestLimit": {
    "namespaceId": "1001",
    "limit": 120,
    "period": 60
  }
}
```

The object is closed and requires `namespaceId`, `limit`, and `period`. `namespaceId` is a canonical positive
decimal string for a safe integer no greater than `Number.MAX_SAFE_INTEGER`; `limit` is a positive safe integer;
and `period` is `10` or `60`. Use a namespace identifier from the installation's own Cloudflare account. Namespace
identifiers are unique within an account, so independent installations need distinct choices. The preparatory
commands do not allocate namespaces, contact Cloudflare, or infer a production value.

If omitted, the generated target is unchanged: it has no `ratelimits` entry and no
`BROWSER_INGEST_LIMITER_REQUIRED` variable. When selected, `ratelimits` contains
`{name:'BROWSER_INGEST_LIMITER', namespace_id, simple:{limit, period}}` and
`vars.BROWSER_INGEST_LIMITER_REQUIRED` is `'true'`. Prepared-installation regeneration and equality checks reject a
removed or changed binding or flag.

For each browser HTTP request, including `POST`, preflight, and retries, the Worker checks the key
`tallyfin-browser:${projectId}` before D1. This counts requests rather than events. A permitted request continues
through the existing project limits and quotas. A denied request returns 429 before D1 with the existing conservative
`Retry-After: 60`, including for a 10-second window. A required but missing binding, invalid required flag, or
malformed response, throw, timeout, or cancellation returns 503 before D1. Server authentication and publishing
authorization, administrator routes, and scheduling keep their existing order.

Cloudflare documents this limiter as approximate and eventually consistent per Cloudflare location; it is not a
strict global cap. See [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
No production namespace or remote limiter deployment is selected in this scope, and no remote capacity result is claimed.

## Administrator Worker Deployment Preparation

`apps/admin/wrangler.jsonc` is the baseline for serving administrator assets and the API from the same origin.
`/v1` and `/v1/*` are forwarded to a separate collector Worker through the fixed `COLLECTOR` service binding.
Authentication, grants, body limits, and collector Origin checks follow existing collector policy, and the API takes precedence when a static API path
also exists. API responses are not converted to HTML, and body, headers, and query are preserved.
There is one call only; redirects, automatic retries, and API caching are not used.

The following commands create local files and run checks without uploading.

```powershell
npm run build:admin
npm run admin:config -- --file .tmp/admin-target.json --out .tmp/admin-deploy/wrangler.json
npm run admin:dry-run -- --config .tmp/admin-deploy/wrangler.json
npm run admin:types
```

The input is `workerName`, `accountId`, `collectorWorkerName`, `workersDev` (an explicit boolean), and optional `domain`.
The operator supplies the first three real values, and the two Worker names must differ.
If `workersDev=false`, `domain` is required. The domain is a lowercase host name without a URL, path, or wildcard
and becomes a custom domain route. Set `collectorWorkerName` to the actual collector deployment name for the environment; separate environment inheritance is not used.
Only closed JSON of 8 KiB or less is accepted; secrets, tokens, and OIDC values are rejected, and existing output is not overwritten.
ID and domain syntax checks do not prove ownership or actual resource existence.

The default admin configuration is for type and package checks, so do not use it directly for production deployment.
Generated files contain the account, collector name, and absolute asset and entry paths. Review the file before actual Wrangler
deployment because custom domain association may occur. Deploy the collector and
administrator to the same Cloudflare account and prepare the collector first. Do not put database access, administrator JWT keys, or
publisher credentials into the administrator Worker.

A missing binding or invocation exception returns an `admin_api_unavailable` 503 JSON response with `Retry-After: 5`.
HEAD error responses have no body. The administrator UI distinguishes this connection failure from storage errors.
Logs contain only fixed codes; exceptions, tokens, and request URLs are not written. To protect the callback code and state,
invocation logs and automatic traces are disabled and query redaction is retained.
API and database contracts remain unchanged; this error occurs only at the administrator transport boundary.

`/auth/callback` and `/demo` are administrator app routes. OIDC client settings are read separately at build time from
`VITE_OIDC_` in `apps/admin/.env`, and tokens are not included in the bundle.
The callback must be `/auth/callback` on the final administrator HTTPS origin.
The initial workers.dev provider, sign-in, service binding and D1 deployment were verified on 2026-10-25. Custom-domain DNS and other independent installations require separate verification. Static fallback must internally fetch `/`, because ASSETS redirects `/index.html` to `/` and would otherwise discard callback parameters.
Sites packaging remains supported, but default hosting has no collector binding, so production connectivity uses the
Wrangler configuration above. To roll back, restore the administrator Worker code and binding configuration together.
Collector code, the database, and records are not changed.

## Types and Verification

- Generated `npm run collector:types` output goes in `.tmp`. The source-of-truth documents are `wrangler.jsonc` and the operator-prepared per-target configuration.
- `npm run typecheck` generates bindings, then checks shared code and platform wiring code separately.
- `npm run admin:types` generates administrator bindings and checks the Worker with checkJs from `tsconfig.worker.json`.
  The root typecheck includes it.
- `node --test --test-timeout=30000 apps/admin/test/edge.test.ts tools/runtime/test/admin-target.test.ts` runs against
  temporary keys, static fixtures, and a real local collector and D1. It does not write remote resources.

## Logging and Observability

- App logs contain only structured error codes, execution IDs, and cleanup counts.
- `observability.logs` is enabled, `invocation_logs` is false, `redact_query_string` is true, and traces are disabled. This is because automatic traces and invocation logs can include request URLs and conflict with the product privacy contract. The app cannot control platform-side access logs.
- Wrangler `send_metrics` is false.
- This work makes no schema or OpenAPI changes.

## Rollback

- To stop locally, stop the process. Remote code rollback and cleanup schedule changes are approved follow-up work.
- Restoring an earlier config revision does not restore data that has already been deleted.
- Back up the stopped local directory before an experiment.

## References

- [provisioning.md](./provisioning.md), [oidc.md](./oidc.md), [retention-cleanup.md](./retention-cleanup.md), [VALIDATION.md](../../VALIDATION.md)
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
