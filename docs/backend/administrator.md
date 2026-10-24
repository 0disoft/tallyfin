# Administrator Read and Settings Boundary (apps/collector)

## Workflow Failure Reason Aggregation — 2026-10-23

A workflow's selected `failureReasonProperty` references only one enum property on failure events.
Free-form error messages are not accepted. The `failureReasons` property in the daily response and in each selected
`days` entry provides the property name, sorted enum buckets, `measuredFailures`, `missingReasonFailures`, and `unmeasuredFailures`.
It is null when unset, and an older server may omit the field. A missing reason is included in measured failures and
distinguished from historical unmeasured failures. The denominator for rates is all finalized failures, including missing and unmeasured reasons.

The start-date cohort, version, and authorization boundary are retained, and only the first finalized failure is aggregated in the existing CAS batch.
If the end arrives first, aggregation occurs when the start is observed. Retransmission does not overwrite the first reason or count it again.
The aggregate remains for its retention period after attempt cleanup. The existing SQL count is unchanged; rows and responses grow.
Apply database migration 0013 before the new collector; it has not been applied remotely.

## Workflow Completion Duration — 2026-10-23

An optional `duration` was added to the existing workflow daily response and to each `days` item.
The new server always provides it, while older responses may omit the field. Six fixed buckets are provided for success and failure separately,
and `measuredAttempts` and `unmeasuredAttempts` distinguish previously unmeasured completions. Totals must
match the period and daily completion counts. Definitions without failure events also have null failure bucket counts.

Duration is browser `occurredAt` minus `startedAt`; it is not server processing time, an average, or an exact percentile.
0 ms and exactly 24 hours are valid, and values on an intermediate boundary belong to the next bucket. The start-date cohort, project,
version, and browser source are retained, and aggregate values are read from the same snapshot as the existing authorization SQL.
Only the first finalized completion is measured in the same CAS batch as the existing completion delta. If the end is observed first,
it is measured when the start is observed, and retransmissions or a different eventId for the same step are not counted again.
An unmeasured completion is not interpreted as 0 ms. Records before 0012 are not backfilled automatically.
The values are stored in existing daily rows, so they remain for the 90-day aggregate period after the 72-hour attempt cleanup.
The SQL count for daily reads, overview, ingestion, and cleanup does not increase, while read and row bytes do.

## Project Name and ID Search — 2026-10-23

`GET /v1/projects` accepts an optional `q` for a substring search of project names or IDs. Only ASCII letters are
matched case-insensitively; Hangul characters and symbols are compared exactly. `%` and `_` are not wildcards.
Leading and trailing whitespace is removed, and a blank value uses the existing full list. The original query may contain at most 80 UTF-16
code units, and a control character returns 400. The URL-encoded query is limited to 1,024 characters on this route only, which allows
80 Hangul characters. Authentication runs before input validation.

The search condition and reader/owner grant are bound in the same SQL, and `limit+1` rows are read after filtering.
ID ordering, the existing cursor, and the response format are retained, and authorization is checked again on every page. The next
page passes the same `q`; if the query changes, start without a cursor. A cursor does not prove search or authorization,
and results can change when names or grants change in a live list. Search uses one SQL statement, with no separate index for substrings.
Large-scale production latency has not been measured.

## Service Overview

`GET /v1/overview?projectIds=sembom,other&source=browser` accepts 1 to 5 unique IDs and only the
browser or server source after authentication. In request order it returns events for the most recent and previous 7 days under the latest active schema,
the browser workflow completion rate referenced by the schema's `representativeWorkflowId`, the most recent receipt, and
the total rejection count for the most recent 7 UTC days. A normal omission leaves the workflow name and completion rate
null and does not select the first workflow. Invalid syntax or a reference missing from the same version is rejected during draft
validation and publishing, while a stored definition that violates the contract marks that row as an error.
The server computes periods in the project time zone. A suspended latest version is not selected.

`workflowStats` provides start, success, failure, and in-progress counts for the current and previous periods, plus `provisional`.
The failure count is null for a workflow without failure events. Completion rate keeps the existing success/start calculation, and
`provisional` follows the existing rule that data remains provisional until 2 days after the end of the local date. No
workflow, authorization or aggregation failure, or a server source produces `workflowStats=null`. No additional SQL is run.

The `period` on a successful row specifies `timeZone`, `from`/`to`, and `previousFrom`/`previousTo`. A period is provided even when there is
no active schema; an error or lost-authorization row clears it with `period=null`. `generatedAt` fixes the time used for period calculations at the request
time; it does not mean that all database reads are a snapshot at one instant.

After one metadata read, one authorization recheck and aggregate batch, rejection records are read in sequential
pages for each service. Up to 4,096 rows are aggregated immediately rather than accumulating raw records, with a maximum of 17 batches and 42 SQL statements.
The grant condition applies to every aggregate, and a change to the active version, definition, or time zone between the two batches causes a query failure
for that service. Unregistered projects and missing authorization produce the same `accessDenied` error row with all values null.
Without an active schema, only event and completion values are null; recent receipt and rejection
counts remain available as project diagnostics. A true zero (no rejection records) is distinguished from an unqueried null.
Authorization is checked again for each rejection page; if it is revoked, the entire row, including earlier aggregates, is cleared.
Corruption or storage failure while reading rejections discards partial totals and fails only that panel. Changes or cleanup
between pages can change results, so rejection totals are not a single-instant snapshot.
A metadata or analytics SQL execution failure produces a total 503. If a custom AdminStore has no optional overview port, the response is 503 and the
code does not automatically repeat individual requests. Responses use no-store and `Vary: Authorization`, and CORS is not allowed.
The abort signal is checked before the first read, after a batch, and before starting the next batch, and it stops new reads.
It does not guarantee cancellation of a D1 execution that has already started.

## Current Signed-in Account

`GET /v1/identity` verifies the administrator access token's signature, issuer, audience, and validity period,
then returns only the caller's `{ issuer, subject }`. It does not require a project grant or creator permission, so
the initial production account can confirm its identifiers. It does not issue authorization or credentials or read or write the
database, and it returns no email, profile, other accounts, tokens, or roles.
It does not substitute the OIDC ID token `sub` or a browser-supplied subject.

It accepts GET only and rejects query parameters. Unconfigured authentication, an invalid bearer, or failed verification returns 401;
an invalid query returns 400; other methods return 405 with `Allow: GET`. The response uses no-store and
`Vary: Authorization`, and adds neither cookies nor CORS access. The issuer and subject are each at most 512 characters
and follow the validated grant identity rules. This route is for confirming that the account and provider match before an operator
registers initial authorization.

## Administrator Storage Read Check

`GET /v1/health` accepts only a verified administrator bearer. It is not a public health check. It only needs to pass the same
grant identity check as `/v1/identity`; no project grant or creator permission is required. If the host connects a
`checkReadiness` port, it reads the two control-plane tables `projects` and `project_grants` with
`SELECT 1 ... LIMIT 1` and, on success, returns only `{status:'ok', scope:'administrator_storage_read'}`.
It does not expose rows, accounts, or project data. Without the port, it returns 503
`storage_unavailable`; methods other than GET return 405 with `Allow: GET`. Success does not verify ingestion writes, aggregation, cleanup, or complete
logging. Operational observability follows [Operational Observability](../ops/observability.md).

Status: Administrator reads (GET), source-specific aggregate reads (`source`), funnel daily reads (`funnel`), project settings
read and change (PATCH), project grant registration, role change, and revocation (PUT and DELETE), project change history
read (GET), the verifier port, and the OIDC JWT signature verification adapter have been implemented and verified locally. A real
identity provider, sign-in flow, token issuance, and production settings have not been connected yet.

The host connects a trusted verifier through `createWorker(verifyBearer)`. `verifyBearer` checks the
signature, trusted issuer, audience, and validity period, then returns `{ issuer, subject }` or
null. The default export in `apps/collector/src/index.ts` is created without a verifier and
closes administrator routes with 401. A missing verifier or an empty bearer, issuer, or subject returns 401.
Project settings routes accept GET and PATCH and return 405 with `Allow: GET, PATCH` for everything else; project grant
routes accept GET, PUT, and DELETE and return 405 with `Allow: GET, PUT, DELETE` for everything else; the draft validation route
accepts POST only and returns 405 with `Allow: POST` for everything else; project list and creation routes accept GET and POST
(`Allow: GET, POST`); version-specific schema routes accept GET and PUT;
every other read route returns 405 with `Allow: GET` for any method other than GET.

The following is an example host adapter file at the repository root. The `@tallyfin/collector` package has no `exports`,
so it is imported by source path. `hostVerify` is a placeholder the host must fill in, and this repository has no
implementation for it.

```ts
// worker.ts (host adapter at the repository root)
import { createWorker } from './apps/collector/src/index.ts';

export default createWorker(bearer => hostVerify(bearer));
```

`createOidcWorker(options)` can also be used with a standard JWT access token provider.
The operator specifies the issuer, API audience, and HTTPS public-key address. Supported profiles and cache
refresh limitations are described in the [OIDC Adapter](./oidc.md).

Each project read checks the role (reader or owner) in `project_grants` for the verified issuer and subject.
Authorization is not obtained from a screen selection, cursor, or public projectId. A missing grant returns 403, a missing definition or version
returns 404, and a storage error returns 503. Authentication never relies on a plain JWT decode.

The supported read routes are the GETs below. Writes are project creation POST, settings PATCH, version-specific schema PUT,
project grant PUT and DELETE, and publisher authorization PUT and DELETE. Draft validation POST is a read operation that does not store data.
Publisher grant and revocation follow the publisher registration and revocation rules below, and the provisioning
CLI (`publisher-grant` and `publisher-revoke`) can still be used. The publisher list is read through the owner-only
GET above.

- `GET /v1/projects` — Accessible project list. Default limit 25, maximum 100, cursor pagination.
- `POST /v1/projects` — Creates a project only for an administrator with separate creator authorization. Follow the creation rules below.
- `GET /v1/projects/{projectId}` — Current settings and settingsHash. Reader or owner.
- `GET /v1/projects/{projectId}/publishers` — Current server publisher list, owner only. Returns only publishing authorization, which is separate from administrator grants.
- `PUT /v1/projects/{projectId}/publishers` — Owner grants publishing authorization. Accepts only `{issuer,subject}`.
- `DELETE /v1/projects/{projectId}/publishers` — Owner revokes publishing authorization. Accepts `{issuer,subject,expectedGrantId}`.
- `GET /v1/projects/{projectId}/grants` — Current grant list, owner only. Follow the list rules below.
- `PUT /v1/projects/{projectId}/grants` — Owner registers a reader or owner grant or changes a role. Follow the change rules below.
- `DELETE /v1/projects/{projectId}/grants` — Owner revokes a grant. Follow the change rules below.
- `GET /v1/projects/{projectId}/changes` — Change history, owner only. Follow the change history rules below.
- `GET /v1/projects/{projectId}/collection/rejections?from={UTC-date}&to={UTC-date}` — Ingestion rejection diagnostics for a reader or owner. Follow the UTC diagnostics rules below.
- `GET /v1/projects/{projectId}/schemas/{schemaVersion}` — Immutable registry snapshot.
- `GET /v1/projects/{projectId}/schemas` — Version list and latest version for a reader or owner.
- `PUT /v1/projects/{projectId}/schemas/{schemaVersion}` — Owner publishes a new version.
- `POST /v1/projects/{projectId}/schemas/validate` — Owner-only draft validation with no storage.
- `GET /v1/projects/{projectId}/summary` — Event counts for one version and period. Optional `source` (default browser, browser or server).
- `GET /v1/projects/{projectId}/events/{eventName}/daily` — Daily counts and optional property buckets. Optional `source`.
- `GET /v1/projects/{projectId}/workflows/{workflowId}/daily` — Start-date cohort. Browser source only.
- `GET /v1/projects/{projectId}/workflows/{workflowId}/breakdown?groupBy={dimension}` — Cohort by start-time property. Browser source only.
- `GET /v1/projects/{projectId}/funnels/{funnelId}/daily` — Funnel reach counts and conversion rates for a start-date cohort. Follow the funnel daily rules below.

Aggregate reads require an exact schemaVersion, a from/to period in the project time zone, and a span of at most
31 days within the 90-day retention window. Retired versions and paused projects are read with the same grant. Empty dates are filled with
0, workflow completion rate is `succeeded/started` for the start cohort, and `failedAttempts` is null when the workflow has no failure step;
`provisional` is true until 48 hours after the end of the date.

Only `summary` and `events/{eventName}/daily` accept optional `source` (default browser), and a request reads only one
source. Browser and server counts are neither combined nor substituted. Server definitions also support daily
property classification, and only registered sources and property names are accepted. If the source has no definition, `summary`
returns `events=[]` and `totalEvents=0`; requesting a daily event name that exists only in another source returns 404.
Workflow routes do not accept `source` and read only browser records (supplying `source` returns 400). `meta.source` is the
requested source (default browser), and `meta.latestReceivedAt` is the latest receipt time for the entire project, not a value for a specific
source, version, or date. Read authorization is rechecked against `project_grants` reader or owner on every request, and
`project_publishers` publishing authorization cannot be used to read.

A workflow property read accepts only one of the registered `workflow.dimensions` as `groupBy`. It uses the dimension key stored at
start time and does not infer completion from event-date counts. The existing daily response is unchanged. The response contains
`meta`, `workflowId`, `cohortBasis`, `groupBy`, `summary`, and up to 32 `buckets`. Each bucket contains a value that preserves its
type, `summary`, and up to 31 `days`. Other dimension combinations are summed into the same value, and completion rate is computed from the summed successes and starts. Because it
is a required dimension, there are no null buckets, and only observed values are returned. An empty result returns `buckets=[]`, and a completion rate with zero attempts is null.
Existing reader or owner authorization is rechecked in the same D1 batch as definitions and aggregates. Up to 7,936
source rows are read, and an overflow or corrupt data returns 503. There are no storage or migration changes.

## Funnel Daily Query

`GET /v1/projects/{projectId}/funnels/{funnelId}/breakdown` reads a funnel split by a required start-date dimension
that was already stored. `schemaVersion`, `from`, `to`, and `groupBy` are required. `groupBy` is one of the optional funnel's
`dimensions`, and the query combines browser and server sources for its steps, so it does not accept `source`. It reads the
project reader or owner grant, definition, and aggregates in the same D1 batch, and every SELECT checks the grant again.
The range is 1 to 31 days within the most recent 90 days, reading at most 256 original dimension combinations, 10 steps, and 79,360 rows.
It requests one row beyond the limit and rejects an overflow with 503.

The response contains source-free `meta`, `funnelId`, `definition`, `cohortBasis` (`startedAt`), `groupBy`, overall `summary`, and
up to 32 `buckets`. Each bucket's value is a registered string, boolean, or integer; false and 0 are preserved.
Because the dimension is required, there are no nulls, and `buckets` is an empty array when there are no observed rows. Each bucket contains a
`summary` and `days` for every queried date; days without data have count 0 and a null rate. Rates and `provisional` match the
daily query; they are calculated from total counts rather than an average of daily rates.

Before combining other wrapped dimensions, it checks the consecutive reached-step count for each date and original combination. An unregistered value,
duplicate step, different date, invalid dimension JSON, unsafe-integer overflow, or greater count at an earlier step returns 503.
`runId`, `dimension_key`, and raw events are not included in the response. The database and migrations are unchanged; this read
API has been implemented and verified locally. The administrator classification screen and CSV connection are the next step.

`GET /v1/projects/{projectId}/funnels/{funnelId}/daily` reads start-date cohort reach counts and
conversion rates for a registered funnel. `schemaVersion`, `from`, and `to` are required, and the query reads 1 to 31 days
(inclusive) within the most recent 90 project-local days. Definition read, aggregation, and reader or owner grant checks run in the same D1 batch.
It does not accept `source` or `groupBy`; either returns 400. Browser and server sources for each registered step and
all dimension combinations are combined into one start-date cohort; there is no source split or visitor reconstruction.

The response contains `meta` (no source), `funnelId`, `definition`, `cohortBasis` (`startedAt`), `summary` (`FunnelCounts`), and
`days` filled with 0. Each step contains `stepIndex`, `reachedRuns`, `reachRate`, `conversionRate`, and `notReachedNext`;
`reachedRuns` is nonincreasing. `reachRate` is relative to the first step, `conversionRate` is relative to the immediately preceding step,
and rates with a zero denominator, the first step's `conversionRate`, and the last step's `notReachedNext` are null. Results are `provisional` until 48 hours after the end of the
project-local date, and they include incomplete and undelivered work, so failure to reach the next step is not proof of failure or abandonment. Paused projects and
retired versions remain readable. Unknown schema or funnel returns 404, missing authentication returns 401, missing grant returns 403, malformed input returns 400,
and corrupt or oversized data returns 503. Responses use no-store and do not expose run IDs. At most 310 grouped rows are returned, and an overflow returns 503.
There are no storage or migration changes.

## Ingestion Rejection Diagnostics — UTC Receipt Date

`from` and `to` are required UTC dates and must select at most 7 dates within today and the preceding 6 days.
They are independent of project time zone, schema version, and event occurrence date. A reader or owner can read a paused project or a
project without a schema, and the grant and aggregates are checked in the same D1 batch.
Extra or duplicate parameters return 400, missing authentication 401, missing grant 403, missing project 404,
methods other than GET 405, and corrupt JSON, timestamps, reasons, safe integers or totals, or a database failure 503.

The response contains `meta` (`UTC`, `receivedAt`, `retentionDays=7`, `coverage=best-effort`), overall `summary`,
and `days` for every requested date. Each summary contains the rejected request count, the receipt time of the most recent rejected request, and
10 fixed cause buckets. With no records they are 0 or null, and a storage failure is not filled with 0.
`minute_limit` and `daily_limit` both appear as `quota_exceeded` in public responses but are distinct here.
Rejections for OPTIONS and invalid methods may be included. These values do not represent event count, visitor count, rejection rate, or
quota usage. The response does not return raw data, source, IP, token, requestId, or event ID.

The values combine rejection records for browser ingestion and server ingestion that passed publishing authorization. Counts are not split by
source, and requests first rejected during server authentication or publishing authorization checks are not recorded.
Additional diagnostics are best-effort and exclude storage failures, unknown projects, administrator or API authentication failures,
admission database failures, and history from before the migration. Diagnostics may be stored after the response,
so an immediate read may not include them yet. A read is limited to 10,080 minutes and 7 days with 10 causes.
The settings screen's collection-status diagnostics now shows rejection summaries and daily details locally. Follow the [response example](../../api/examples/collection-rejections-response.json).

## Project Settings Read and Change

`GET /v1/projects/{projectId}` returns `{project, allowedOrigins, limits,
settingsHash, canEdit}` to a reader or owner. `canEdit` is a snapshot boolean indicating whether the verified principal making the request
has an owner grant for that project, so it is false for readers.
Paused projects remain readable, and no schemaVersion is required. `settingsHash` is
the SHA-256 of the canonical JSON for `project`, `allowedOrigins`, and `limits`, so
`ingest_revision`, aggregates, and schemas are not included, and `canEdit` is also excluded.

`PATCH /v1/projects/{projectId}` is owner-only. The body is UTF-8 JSON of 16 KiB or less with
`application/json` or `text/plain` (identity encoding), validated as closed JSON.
Only `name`, `status` (`active` or `paused`), `allowedOrigins`, and `limits` can change, and only the supplied `limits`
keys are merged. `expectedSettingsHash` and at least one changed field are required. `allowedOrigins` accepts only
exact HTTPS origins; loopback HTTP is allowed only when `allowLocalHttp` is explicitly enabled. `id`, `timeZone`, `schemas`, `grants`, and
`aggregates` cannot change, and existing usage limits and schemas and data remain as they are.

`canEdit` is a display value from the read snapshot and is not used directly to decide write authorization. A change checks
the grant again at write time and compares `expectedSettingsHash` with the current value, then applies the update atomically.
If owner authorization has been revoked, it returns 403. If the hash is stale or another settings change
overlapped, it returns `settings_conflict` (409). A change in `ingest_revision` caused only by ingestion is not a conflict.
A settings change increments `ingest_revision` by 1 to coordinate with conflict checks for in-flight ingestion. If a response is
lost or a 409 is returned, read and compare the current settings before retrying; do not overwrite the new hash.

## Schema Draft Validation

Read an already published definition through the existing `GET /v1/projects/{projectId}/schemas/{schemaVersion}`, then
send only `{events, workflows, funnels?}` to `POST /v1/projects/{projectId}/schemas/validate` for validation.
Other fields such as project, version, status, and allowed source are not accepted. After authentication, POST checks the project
settings and owner grant in the same database read and, if unauthorized, returns 403 before reading the body. Paused projects
can also be validated. A reader can only read published schemas.

The body uses identity-encoded `application/json` or `text/plain`, with a 32 KiB UTF-8 limit.
The 16 KiB limits on other ingestion and settings routes remain unchanged. Query parameters are not accepted.
Invalid JSON, a closed-envelope violation, or non-array events, workflows, or optional funnels returns 400; an oversized body returns 413;
an unsupported media type or encoding returns 415.

Semantic validation of a definition returns 200 with `{valid, issues, privacyReviewRequired: true}`.
For a valid draft, `issues` is an empty array. If there are errors, it returns the JSON pointer `path` and stable `code` of the first error.
Input values and database errors are not included in the response or logs. The codes are
`invalid_definition`, `definition_limit`, `duplicate`, `cardinality_limit`,
`invalid_reference`, and `dimension_mismatch`. `browser_event_required` remains in the contract for compatibility with older
responses, but the current validator does not emit it. Drafts containing only server definitions are also validated.

Validation uses the same core functions as actual registration to check 1 to 50 events, up to 10 workflows, up to 4 properties per event,
type count and possible-combination limits, workflow references, and required-dimension consistency. Event sources must be the browser or server
string. Even after validation succeeds, an operator must review whether enum values contain personal information.
Drafts, schemas, settings, usage, and aggregates are not written, so repeated requests do not need an idempotency key.
Validation does not reserve a version or guarantee publication; publication performs validation and authorization checks again.

## Publishing a New Schema Version

The list GET returns metadata in descending version number order. The default limit is 25 and the maximum is 100;
`beforeVersion` is an exclusive cursor that selects versions lower than the last version on the previous page.
`latestVersion` is the highest version in that snapshot regardless of the cursor and is null when no schema is registered.
The grant is checked again on every page, and paused projects and retired versions are included. Full definitions are read through
the existing version-specific GET.

The publishing PUT body is `{expectedLatestVersion, privacyReviewed: true, events, workflows, funnels?}`.
It accepts identity-encoded `application/json` or `text/plain`; the body limit is 33 KiB UTF-8 and the definition limit is
32 KiB. Event and workflow rules are checked again with the same functions as draft validation.
Optional funnels share the same limits and validation. There can be up to 10 funnels, with ordered steps of 2 to 10, and every step must match its
registered source, event, and required classification domain. Omitted definitions retain their existing hash, while explicitly supplied
funnels are included in the definition hash, immutable version, and retry comparison.
Step-link ingestion and the funnel daily read API have been implemented and verified locally; the administrator funnel analysis screen, CSV,
and funnel-specific step editor form have also been connected locally.
`privacyReviewed` is the owner's confirmation of review, not automatic personal-information detection. Project, status,
allowed origins, and ingestion limits cannot be included in the body. Closed input or an invalid definition returns 400.

The new number must be greater than every existing version, and `expectedLatestVersion` must equal the current highest number.
`null` publishes the first version only when there is no schema. The owner condition, highest-number check,
insert, and `ingest_revision` increment run in one D1 batch. If authorization is revoked immediately before storage,
the request returns 403; writing the same number with different content or a changed highest number returns `schema_conflict` (409).
A revision change caused only by settings or ingestion does not reject publication.

Retrying with the same version and the same canonical definition returns 200 with the existing publication metadata and does not
store more data or increment the revision, so the same PUT can be retried after a lost response.
If a higher version is created later or that version becomes retired, retrying the same definition returns the current state
and does not reactivate it. A separate `Idempotency-Key` is not required.
Equality normalizes only object key order and preserves array order.

Existing versions, aggregates, and settings are retained, and only the new version becomes active. Older versions are not
automatically retired. Publishing does not change the SDK's selected version, so an adopting product must review the
new definition and switch to the version explicitly. The response contains `projectId`, `schemaVersion`,
`schemaStatus`, `publishedAt`, and the SHA-256 `definitionHash` of canonical `{events,workflows}`.

D1 batch rollback and execution order follow the [official D1 documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
Revision changes depend on whether the preceding insert occurred and are implemented using
[SQLite changes()](https://www.sqlite.org/lang_corefunc.html#changes); publishing, retries, concurrent publication, and rollback after failure
were checked in Miniflare.

Project creation uses a separate creator authorization API or the provisioning CLI.
Schema status changes remain with the existing provisioning CLI. Grant registration, role changes, and revocation have been implemented locally through the new owner
API (PUT and DELETE), and the provisioning CLI remains an alternative. The permission change UI in the administrator screen has been implemented and
verified locally; identity provider configuration and remote deployment are follow-up work. Request and response shapes follow
[OpenAPI](../../api/openapi.yaml), and behavioral semantics follow the
[Event and Aggregation Contract](./event-contract.md).

## Project Grant List

`GET /v1/projects/{projectId}/grants` is readable only by the current project owner. Readers, owners of another
project, users without a grant, and nonexistent projects return 403. The list is readable when the project is paused or has
no schema, and the owner check is repeated on every page using the verified caller's issuer and subject. Authorization and the list are read in the same D1 batch.
The [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) defines the
transaction semantics; authorization revoked during a read is checked again on the next page.

The response is `{projectId,data:[{issuer,subject,role,createdAt}],page:{limit,nextCursor}}`.
`createdAt` is the time the grant was first created and is not reset by a role change. Names and email addresses are not
inferred, and authentication tokens or user profiles are not returned. Issuer, subject, and cursor are treated as administrator
identifiers and are not written to request or response logs. The response uses no-store.

The default limit is 25 and the maximum is 100, ordered by SQLite BINARY order of issuer and subject.
Pass `nextCursor` unchanged to the next page; null means the end. The cursor is a base64url position value containing the project and last
identifier (up to 12,288 characters) and grants no authorization. Invalid format, a cursor from another project, duplicate or extra
parameters, or a query over 12,352 characters returns 400. Omit the cursor or send an empty value for the first page.
Identifiers up to 512 characters each and Unicode are supported. Each page reads the current database, so grants inserted
before the previous position require rereading the list from the beginning. Reads do not change grants, settings, or ingestion usage.

## Project Grant Changes

`PUT /v1/projects/{projectId}/grants` and `DELETE .../grants` are writable only by the current project
owner. Readers, owners of another project, callers whose issuer differs, revoked owners, and nonexistent
projects return 403. Before reading the body, the router preflights whether the verified caller is the owner; immediately before
the write, the atomic database batch performs the owner condition, CAS, last-owner guard, and result read together.
The body is closed JSON, accepts only UTF-8 identity encoding of 16 KiB or less, and does not accept query parameters.
Issuer and subject use the same constraints as the [provisioning CLI](./provisioning.md).
The PUT body is `{issuer,subject,role,expectedRole}`; the DELETE body is
`{issuer,subject,expectedRole}`.

`expectedRole` is the role the caller last saw. On PUT, null means a new registration, and reader or owner is a CAS against the
currently stored role. If the target already has the desired role, no write occurs and it succeeds with 200 and `changed=false`;
otherwise a stored role different from `expectedRole` returns `grant_conflict` (409). On DELETE, null means the caller believes
no grant exists, and an absent grant is an idempotent success with `changed=false`. A stored role different from `expectedRole` returns `grant_conflict` (409).

A role change preserves the original `createdAt`. Demoting or revoking the last owner to reader returns
`last_owner` (409). If another owner exists, a caller may lower or revoke their own grant; the response then has
`canManage=false`, and later owner API calls return 403. A successful response is 200 with
`{projectId,issuer,subject,role,createdAt,canManage,changed}`; when `role` is null, `createdAt` is also null.
This API and the permission change panel in the administrator screen have been implemented and verified locally.
The screen prepares candidates and stores them only from the confirmation panel; when the result is unclear, it retries only the same request,
and when access is lost, it locks the list and editor. There are no database or migration changes, deployments, or production identity
credentials.

## Publisher Registration and Revocation

`PUT /v1/projects/{projectId}/publishers` and `DELETE .../publishers` are writable only by the current project owner.
Readers, owners of another project, revoked owners, and nonexistent projects return 403, and a principal that has only
`project_publishers` publishing authorization separate from administrator grants also returns 403. Before reading the body, the router checks that the caller is owner;
immediately before writing, the atomic D1 batch performs the owner check, authorization write, audit record, and result read together.
Every write statement in the batch also carries the owner `EXISTS` condition, so if the owner is revoked between reading the body and executing the batch,
the write changes zero rows, nothing changes, the owner read is empty, and the response is 403.
Revocation relies on the condition blocking the write, not on exception rollback. The body is closed JSON and accepts only
`application/json` and `text/plain` with UTF-8 encoding and a 16 KiB limit; query parameters are not accepted.
An oversized body returns 413, and another media type or nonidentity encoding returns 415. Issuer and subject use the
`validGrantIdentity` constraints from the [provisioning CLI](./provisioning.md).

The PUT body is `{issuer,subject}`, and the DELETE body is `{issuer,subject,expectedGrantId}`.
`expectedGrantId` is the immutable grant generation last read, as a 32-character lowercase hex string or null.
Null means the caller believes no grant exists. A PUT with `granted` true does not accept `expectedGrantId`.
Sending the former `expectedCreatedAt` field returns 400.

Granting an existing publishing authorization again succeeds with 200 and `changed=false` without rewriting the database, and it does not change
the existing row or its `grantId`. If the target grant row is absent, the operation is a no-op with `changed=false` regardless of
`expectedGrantId` (after revoking with the ID just read, resending the same valid ID or null still succeeds as a no-op because the row
no longer exists). The DELETE CAS compares `expectedGrantId` with the stored `grant_id`; a mismatch returns
`publisher_conflict` (409), and the caller must read again. `grant_id` is newly assigned on every grant, so
grants regranted in the same millisecond remain distinguishable. The `immutable_publisher_generation` trigger prevents UPDATEs to the row,
so revocation is a deletion and granting is a reinsertion.

A successful response is 200 with `{projectId,issuer,subject,granted,grantId,createdAt,changed}`; `granted`,
`grantId`, and `createdAt` are paired (grant is true, grant ID, and creation time; revocation is false with null values).
Credentials and roles are not included.
The change history audit (`publisher.granted` and `publisher.revoked`) is written in the same D1 batch as the authorization write and is inserted only
when the preceding write changes one row. A no-op performs neither an authorization write nor a history addition; if an audit INSERT fails after one row changes,
the same batch rolls back the authorization change. Status codes are 200, 400, 401, 403, 405 (`Allow: GET, PUT, DELETE`), 413, 415, and 503, with
409 added only for DELETE. This API does not issue credentials or change administrator grants.
The database uses the state from migration 0009 that adds `grant_id` to `project_publishers`, and audit uses the existing 0008 action.
The owner-only `LivePublishers` in settings is also connected locally, and the CLI remains usable.

## Publisher Management Screen

In the `apps/admin` settings screen, the owner-only `LivePublishers` is connected between `LiveGrants` and `LiveAdminChanges`.
The list reads 25 items at a time and provides next-page navigation and refresh from the beginning. It prepares a grant from issuer and subject,
and uses the `grantId` observed in the list as `expectedGrantId` when preparing revocation.
The registration-time table remains visible, and `grantId` is not shown on screen.
Both writes are sent only after explicit confirmation. On conflict, the latest list is reread for recovery; when the result is uncertain,
the original request is retried unchanged. After storage, the existing administrator change history is refreshed.

Request cancellation and late-response discard are applied, and identifiers in the list and input are cleared when authorization is denied or the project changes.
The settings form and grant changes are locked while a publishing-authorization write is in progress or its result is uncertain.
The table has a minimum width of 640 px and scrolls horizontally inside a keyboard-focusable `table-scroll` container.

Local browser verification used real Chrome, a test collector with temporary-password OIDC verification, and local D1 to confirm no write before confirmation,
two audit rows for grant and revocation plus a third row for a subsequent regrant, settings and grant locking during a held PUT response, and
screen identifiers being cleared on refresh after owner revocation. At 320 px there was no document horizontal overflow or console
error. A real Chrome, temporary OIDC, and local D1 smoke test (a stale revocation of a same-millisecond regrant returning 409), 19/19 focused administrator checks,
153/153 API and model checks, type checking, build, bundling 2/2, and sites 9/9 passed locally.
Detailed results are in [VALIDATION.md](../../VALIDATION.md).
This slice changes the publisher API contract and screen around `grantId`, and the database uses `grant_id` from 0009.
Real providers, remote resources, deployment, and Sembom integration were not verified.

## Project Change History Read

`GET /v1/projects/{projectId}/changes` is readable only by the current project owner. Readers, owners of another
project, nonexistent projects, and revoked grants return 403, and owner authorization and records are read in the same D1
batch. Authentication failure returns 401, invalid project or page parameters return 400, methods other than GET return
405 (`Allow: GET`), and corrupt storage returns 503.

The response is `{projectId,generatedAt,retentionDays:90,coverage:'recorded-changes-only',data,page}`.
Each item contains only `id`, `occurredAt`, `actor`, and `change`; settings values, schema definitions, request bodies, and tokens are not included.
`actor` is `administrator` with the verified issuer and subject for an administrator API change, or `local_operator` without identifiers for an offline
provisioning CLI change. Stored null identifiers are not included in the response. `change` contains only values required by `action`. Project creation
contains only `action`; settings changes contain the list of changed field names; schema changes contain the operation and version number; grant changes contain the target issuer and subject
and previous and new roles.
Publishing authorization grant and revocation (`publisher.granted` and `publisher.revoked`) contain only the target issuer and subject
and, unlike administrator grants, no role.

Recorded operations are administrator API project creation, settings change, schema publication, grant change, and publisher authorization
grant and revocation, plus provisioning CLI `register`, `grant`, `revoke`, `publisher-grant`, and `publisher-revoke`.
API publisher authorization changes use the verified issuer and subject as actor, while CLI publishing authorization changes use
`local_operator` without identifiers. Direct SQL writes, creator authorization management, system cleanup, and visitor activity are not recorded.

The default limit is 25 and the maximum is 100, ordered by descending `occurredAt` and then by descending record UUID for the same time.
The cursor is a base64url position value tied to the project (up to 512 characters) containing
`[1,projectId,timestamp,recordUUID]`, and it grants no authorization. Invalid format, a cursor from another
project, duplicate or extra parameters, or a query over 512 characters returns 400. Omit the cursor or send an empty value for the first page.

The query window is a rolling 90 days from `generatedAt`, including the cutoff instant and excluding future records.
Expired rows outside the window are hidden even before physical cleanup. `coverage` means that only recorded changes are included;
an empty history is not evidence that no changes occurred. Pages read a live database, so changes added later require rereading from the beginning.
The administrator API connection settings screen provides an owner-only 25-item list, page navigation, and retry. Readers do not request it, and
the first page is refreshed after settings or authorization are stored. Production authentication, remote D1 application, deployment, and Sembom integration do not exist.

## Project Creation

`POST /v1/projects` requires an issuer and subject verified by a trusted verifier and separate creator authorization in
`project_creators`. A project reader or owner cannot substitute for this authorization.
Without authorization, it returns 403 before reading the body. Operators grant and revoke creator authorization and a 1 to 1,000 project limit with
creator-grant and creator-revoke in the [provisioning CLI](./provisioning.md). It does not automatically register an existing project owner
as a creator or accept issuer, subject, or owner claims from a client.

Input accepts only `{id,name,timeZone,allowedOrigins,limits}`. Both ingestion limits must be
specified, and the name length, HTTPS origin, and loopback opt-in rules match the settings API.
The time zone is validated as an IANA name and cannot be changed after creation. `name` rejects whitespace-only strings and control
characters. The request has no query parameters and uses identity JSON or text/plain with a 16 KiB limit.
A new project is created as active with no schema; the first publication uses the existing schema PUT.
Ingestion is not allowed until a schema exists.

The project, original creation request hash, and initial owner grant are stored in one atomic D1 batch.
The INSERT checks creator authorization and that principal's API creation record count again, so concurrent creation
cannot exceed the limit. Existing projects registered through the CLI are not included in that count.
The new owner is the authenticated creator, and no other projects, schemas, aggregates, or usage are changed.

Both initial creation and a retry succeed with 200 and `{projectId,createdAt,creationHash}`. It uses the public project ID,
authenticated creator, and initial request hash instead of a separate `Idempotency-Key`.
Only the allowed origin list is sorted for the hash; other values are not guessed or replaced with defaults.
The same original content from the same creator returns the original creation result even after settings changes, schema publication, or reaching the project count limit.
Current creation authorization and owner grant are still required. A retry does not roll back changed settings or restore a revoked grant. A lost
response is confirmed by repeating the same request.

Different content, a different creator, or an ID already claimed by the CLI returns `project_conflict` (409); reaching the count limit returns
`project_limit_reached` (409). When both the limit and an ID conflict apply, the limit error may take precedence.
Neither error exposes existing project content or creators. Creation history is retained for the life of the project
and is not deleted when creator authorization is revoked. Request bodies and database errors are not included in logs or responses.
A new database requires migrations 0001, 0002, and 0003; an existing database requires applying the addition from 0003. It has not been applied remotely.
