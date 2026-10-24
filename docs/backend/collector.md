# Collector Implementation (apps/collector)

Status: A minimal browser collector and server publishing endpoint have been implemented and are
checked with local Miniflare HTTP tests. The Worker is a native fetch boundary and calls `packages/core` (validation, normalization, and hashing)
and `packages/storage-d1` (atomic D1 storage). The browser SDK (`packages/browser`) was
implemented and verified separately and is documented in the [Browser SDK](./browser-sdk.md). Administrator routes and
the publisher verifier port have been implemented and verified locally. A real identity provider configuration, remote database application, and production
deployment do not exist yet. This document records only how the contract is applied at the ingestion boundary and the implementation and deployment state.

Behavioral semantics follow the [Event and Aggregation Contract](./event-contract.md), request and response shapes follow
[OpenAPI](../../api/openapi.yaml), body policy follows [HTTP API Policy](./04-http-api-policy.md), and
errors and logs follow [Error Responses](./05-error-response.md) and
[Log Boundaries](./06-logging-and-observability.md). Administrator read routes and the verifier
port are in the [Administrator Read Boundary](./administrator.md). Run commands and current verification status are in
[VALIDATION.md](../../VALIDATION.md).

## Boundary and Routes

`apps/collector` is a Worker based on native fetch. The default `fetch` in `index.ts` creates
`D1Store` from the D1 binding, and `createCollector(store, { now, observe })` handles requests.
`observe` and `monotonicNow` are optional ports, and an error-only `log` port also remains available for the host to pass.
The native Worker passes `observe` instead of `log`.
Local HTTP origins are allowed only when `ALLOW_LOCAL_HTTP === 'true'`.
The storage adapter reads project, version, and policy settings from D1. The core does not depend on the Cloudflare
runtime.

- `POST /v1/projects/{projectId}/batches` — Public ingestion; no administrator credentials.
- `POST /v1/projects/{projectId}/server-batches` — Requires publisher bearer authentication; no CORS.
  The contract is in [Server Publishing Events](./server-events.md).
- Administrator routes match the paths and methods in [OpenAPI](../../api/openapi.yaml). The default export without a connected verifier
  closes them with 401, and a disallowed method returns 405 with that endpoint's `Allow` header.

  - `GET`, `POST`: `/v1/projects`
  - `GET`, `PATCH`: `/v1/projects/{projectId}`
  - `GET`, `PUT`, `DELETE`: `/v1/projects/{projectId}/grants`,
    `/v1/projects/{projectId}/publishers`
  - `GET`, `PUT`: `/v1/projects/{projectId}/schemas/{schemaVersion}`
  - `POST`: `/v1/projects/{projectId}/schemas/validate`
  - `GET`: `/v1/health`, `/v1/identity`, `/v1/projects/{projectId}/changes`,
    `/v1/projects/{projectId}/collection/rejections`, `/v1/projects/{projectId}/schemas`,
    `/v1/projects/{projectId}/summary`, `/v1/projects/{projectId}/events/{eventName}/daily`,
    `/v1/projects/{projectId}/workflows/{workflowId}/daily`,
    `/v1/projects/{projectId}/workflows/{workflowId}/breakdown`,
    `/v1/projects/{projectId}/funnels/{funnelId}/daily`,
    `/v1/projects/{projectId}/funnels/{funnelId}/breakdown`

- `GET /v1/health` — Checks read access to the two control-plane tables `projects` and `project_grants` with a verified administrator bearer.
  The contract is in [OpenAPI](../../api/openapi.yaml).
- Every other path returns `not_found` (404).

`projectId` must match the regular expression `^[a-z][a-z0-9-]{0,47}$`. An unregistered
project returns `not_found` (404) on the browser route and `forbidden` (403) on the server route.
A paused project returns `project_unavailable` (403) on both routes.

## Request Processing Order

Steps 1 through 8 below are the browser ingestion route. The server publishing route follows the separate section below.

1. Read `Origin` and the project first, and set `Access-Control-Allow-Origin` when the origin is allowed.
   Response headers always include `Cache-Control: no-store` and `Vary: Origin`.
2. Reject a disallowed origin with `origin_denied` (403) without writing per-minute admission.
3. Check per-minute admission for an allowed origin (`admit`). Preflight, invalid requests, and duplicates also count.
   If the project is not active after this, return `project_unavailable` (403).
4. `OPTIONS` returns 204 when `Access-Control-Request-Method: POST` is present and
   `Access-Control-Request-Headers` contains only `content-type`. Otherwise it returns
   `invalid_request` (400). A method other than `POST` returns `invalid_request` (405) with `Allow: POST, OPTIONS`.
5. Read the body as a stream and stop with `invalid_request` (413) when it exceeds 16 KiB of UTF-8.
   Only `application/json` and `text/plain` (charset utf-8) are accepted, and both are parsed as JSON.
   A `Content-Encoding` other than `identity` returns `invalid_request` (415).
6. Validate in the order `parseBatch`, `loadRegistry`, then `prepareBatch`. Recheck the origin after
   reading the registry.
7. Apply receipts, attempts, quota, and aggregates in one transaction through `commit`. A successful response returns
   only `accepted` or `duplicates`. Separately from the response body, when the response is ready, emit one completion observation log line
   for the selected response (success is sampled 4 out of 256 based on the first two UUID characters).
8. If `accepted + duplicates` differs from the batch event count, return `storage_unavailable` (503).

Validation order and time boundaries follow the [Event Contract](./event-contract.md). `occurredAt` is allowed only
from 24 hours in the past through 5 minutes in the future relative to receipt time.

### Server Publishing Route Order

The server publishing route has a different order from the browser route.

1. Verify `Authorization: Bearer` with the publisher verifier (`PublisherAccess.verifyBearer`).
   If no verifier is injected or the header or token is invalid, return `unauthorized` (401) before reading the project,
   admission, or the body.
2. Validate the project ID and use the storage adapter's `publisherAccess` to check the `project_publishers`
   grant. A missing grant or unknown project returns `forbidden` (403).
3. Read the project and check per-minute admission, then verify that the method is `POST`, that there are no query parameters, and that
   `Content-Type` is `application/json` only. It does not handle `OPTIONS` preflight
   and does not create CORS headers. A method other than `POST` returns 405 with `Allow: POST`.
4. Continue in the order `parseServerBatch`, `loadRegistry`, `prepareServerBatch`, then `commitServer`.
   The origin recheck exists only on the browser route.

## Errors and Logs

Errors have the shape `{ error: { code, message, requestId } }`. `code` is a fixed enum, `message` is a
short safe explanation, and `requestId` is a random UUIDv4 created for each request. Request bodies, property values,
SQL, tokens, IP addresses, Origins, full URLs, paths, query parameters, methods, headers, and target identifiers are not included in messages or
logs. These exclusions apply only to error messages and operational log lines and do not change the contract for product and administrative data
stored under project keys.

The error-only `log` port supplied by a host records only `{ requestId, code }` and does not change the response if it fails. The native Worker
passes the completion observation port (`observe`) instead, producing at most one line per selected response (`event: http_request`).
Fields, sampling, measurement interval, and limitations are in
[Log Boundaries](./06-logging-and-observability.md).

- A per-minute admission 429 returns the seconds remaining until the next fixed minute (1 to 60) in `Retry-After`.
- A daily quota 429 returns the seconds remaining until the next UTC midnight in `Retry-After`.
- A 503 returns `Retry-After: 1`.
- A 429 `Retry-After` is at most 86,400 seconds (the next UTC midnight). [OpenAPI](../../api/openapi.yaml) uses the
  same limit.
- Administrator routes close with 401 when the host has not connected a verifier (the default export state).
  Once connected, only the endpoint's allowed methods are supported; other methods return 405 with that endpoint's
  `Allow` header.
- The publisher route also closes with 401 when no verifier is present, and a 401 includes `WWW-Authenticate: Bearer`.
  The administrator and publisher use the same 401 message.
- Server route responses use `Vary: Authorization` and do not include `Access-Control-Allow-Origin`.
  `Origin` is not used for authentication.

## Duplicates and Atomicity (Storage Adapter)

`D1Store.commit` reads a consistent snapshot (project, schema, receipts, attempts, and
UTC daily quota) at once for every attempt. If an existing receipt has the same hash and version, it is counted as a
duplicate and nothing is written. Different content or a different version rejects the whole batch with
`event_conflict` (409). A batch containing only retransmissions finishes after a read.

A batch that requires writes is applied in one batch that includes `projects.ingest_revision`.
The compare-and-swap (CAS) guard increments the revision by 1 only when the `ingest_revision`, active status,
time zone, allowed origins, daily limit, per-minute limit, and active schema `definitions_json` read at transaction start are unchanged.
If any value differs, it writes `-1` to fail the CHECK constraint `tallyfin_ingest_revision`. A CHECK failure rolls back the whole batch.

- If provisioning changes project settings or the active schema definition, the CAS fails closed.
  The adapter compares the registry read immediately before commit with the registry supplied by the caller and returns
  `storage_unavailable` (503) if they differ.
- A CAS failure is treated as a retryable condition only when its name is `tallyfin_ingest_revision`. Any other database
  error immediately returns `storage_unavailable` (503).
- Retries include the initial attempt and run at most 3 times, rereading the snapshot on every attempt. If no attempt succeeds within
  3 tries, it returns `storage_unavailable` (503).
- If an aggregate `count` exceeds the safe-integer range, the CHECK rolls back the whole batch. Partial
  accepted results are never produced.

One transaction applies receipts (48-hour TTL), attempt state (72-hour TTL), the UTC daily new-receipt quota,
event daily aggregates, goal daily aggregates, and the project's `latest_received_at` and
`ingest_revision`.

## Quota

- Per-minute admission: counts requests in `ingest_minute_usage` by project and fixed UTC minute (`minute_start`).
  It includes duplicates, invalid requests, rejections, and preflight from allowed origins, and saturates at the maximum limit plus one, or 601.
  Changing the project limit does not reduce the counter for the same minute.
  A new fixed minute starts a new count.
- Daily new receipts: counts `projects.new_receipts_per_utc_day` by project and UTC receipt date.
  Retransmitting the same ID does not increase it. For a new ID at an already counted step, only the receipt is added and
  aggregates are not recounted. Exceeding the limit returns `quota_exceeded` (429) and rejects the whole batch.

## Retention and Cleanup

- Receipts are kept for 48 hours, minimal attempt state for 72 hours, and UTC receipt-date quota until 72 hours after the end of the UTC date.
- Daily aggregates cover the project-local current day and the preceding 89 days, 90 days in total.
- `D1Store.cleanup(projectId, timeZone, now, limit = 500)` deletes up to `limit` records per table per call (1 to 1000).
  Expired receipts, attempts, and quota use `expires_at <= now`; per-minute counters remove minutes older than 2 when
  there is no record; rejection records remove dates outside the most recent 7 UTC days; and daily aggregates remove data outside the 90-day retention window.
- Cleanup is scoped to a project. Expired original events are rejected again by the time check, so they are not
  reaggregated after cleanup.
- By default the Worker `scheduled` handler processes up to 5 projects and 500 rows per table per run.
  If the host confirms sufficient query budget and sets the `cleanupMaxPages` option, it processes up to 4 pages and 20 projects sequentially.
  It does not start additional projects after 20 seconds and limits total database waiting to 30 seconds. It does not process a project twice in one run.
  The traversal position is stored in D1, so it continues after a failed project. A cleanup failure or
  cursor CAS conflict records the run as failed. Follow [Automatic Cleanup](./retention-cleanup.md).
  Remote Cron Trigger registration and activation have not been done.

## Implementation and Deployment State

- Implemented and verified locally: `packages/core` (registration, batches, time, and hashing), `packages/storage-d1` (atomic D1
  commit, CAS, quota, cleanup, grant-condition reads, publishing authorization, and server batch storage), `apps/collector`
  (minimal native-fetch browser ingestion, HTTP boundary, administrator routes, and server publishing endpoint),
  `packages/auth-oidc` (administrator and publisher OIDC verification), `packages/browser` (browser SDK), and
  the `examples/sembom` example, plus the initial empty-database SQL `0001_initial.sql` (for local Miniflare only).
- Administrator reads: The verifier port `createWorker(verifyBearer)` and administrator routes in `admin.ts`
  were implemented and verified locally. Tests use a mocked trusted verifier and the D1 grant boundary. Routes are
  documented in the [Administrator Read Boundary](./administrator.md).
- Completion observation logs: Optional `observe` and `monotonicNow` ports and native Worker wiring were implemented and verified locally.
  Success is sampled 1/64, failures are recorded in full, there are 7 fixed fields, and there is no separate database, network, or dependency use.
  Fields and limitations are in [Log Boundaries](./06-logging-and-observability.md).
- Server publishing: The `PublisherAccess` verifier port and `POST .../server-batches` were implemented and verified locally.
  `createOidcWorker(adminOptions, publisherOptions?)` and `createPublisherOidcWorker(publisherOptions)` attach the publisher verifier. Routes and
  authentication rules are in [Server Publishing Events](./server-events.md).
- The publisher authorization grant and revocation CLI has been implemented locally. Follow the [Registration and Authorization Management CLI](./provisioning.md).
- Local load experiments: `npm run bench:collector` (opt-in; not connected to the default test, check, or CI) uses a new synthetic D1 and loopback HTTP to
  check workflow writes, authenticated reads, duplicate races, mixed funnels, and quota isolation.
  Follow the [local collector load guide](../../tools/runtime/COLLECTOR-BENCH.md).
- Retained-data experiment: `bench:retained` sends HTTP ingestion and reads for 2 minutes against 67,860 synthetic rows in four tables across 6 projects,
  running real scheduled cleanup alongside them. Scope and limitations are in the
  [retained data load guide](../../tools/runtime/RETAINED-BENCH.md).
- Not yet present: production publisher OIDC settings and a real provider connection or production token issuance,
  remote D1 migrations, production Wrangler bindings and secrets, and remote cleanup Cron Trigger registration.
  The cleanup scheduler and cursor have been implemented and verified locally.
- Measurements: The browser SDK stays within a 3 KiB gzip budget (actual values are in [VALIDATION.md](../../VALIDATION.md)).
  SDK initial execution and transmission costs were checked on a synthetic screen (2026-10-08), and collector write and read latency was checked in a local synthetic
  D1 load experiment (2026-10-11). Neither measures a real service; conditions are in the
  [performance budget](../engineering/03-performance-budget.md).
- Local `bench:cluster` ran concurrent sends of the same batch, browser and server funnels, authenticated reads, and cleanup for 120 seconds against a new shared D1 with
  148,260 initial rows and three collector Workers, and confirmed exact duplicate and step aggregates.
  This uses separate Workers in one workerd instance and is distinct from multiple processes or regions. Scope is in the
  [concurrent load guide](../../tools/runtime/CLUSTER-BENCH.md); actual results are in VALIDATION.md.
- Not measured: Cost by project count and registered property-combination scale; long-running, multiprocess, or multi-region Worker load; remote or larger
  datasets; bulk data outside the four tables; and production latency and cost.
- Deployment and activation: No remote D1, production Worker, domain, or identity provider has been configured.

## Public Ingestion Front Limit — 2026-10-23

If the host provides the optional `BROWSER_INGEST_LIMITER` Rate Limiting binding, the browser route applies a
per-project key limit before reading the project, writing to the database, or reading the body. Exceeding it returns
429 with `Retry-After: 60`; limiter failure, cancellation, or timeout returns 503, with no retry.
The limit follows request lifetime and keeps limiter I/O concurrency separate from the database (default 4, optional `maxPublicOperations`).
If a limiter response does not finish after cancellation, it keeps only the limiter slot and does not consume an administrator, server, or cleanup database slot. This step occurs before
reading project existence and allowed origins, so it does not add CORS authorization. The server route preserves the existing authentication and publishing authorization order.

The key contains only the project ID and does not create a new IP, user-agent, or user identifier. Without the binding,
the existing database admission is used. A production host must configure the binding name, namespace, and limit in Wrangler
ratelimits settings. Actual host configuration and remote activation have not been done.
Rate Limiting is an approximate limit by location and does not replace the database's atomic limit check.
[Official binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

The Origin allowlist is not authentication. A forged allowed Origin still reaches database admission.
Rejected Origins and the front limit are visible in HTTP observation logs, and requests rejected before admission are not added
to database rejection diagnostics. Existing stored `origin_denied` records and the API reason enum are retained.
