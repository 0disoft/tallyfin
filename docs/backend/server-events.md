# Server Publishing Event Contract (Core, Storage, and Endpoint Slice)

Status: Server event core validation, normalization, hashing, and the ingest plan; storage and publishing authorization; the dedicated publishing
endpoint; and publisher authentication and runtime configuration wiring have been implemented locally and passed focused verification.
The `project_publishers` grant and revocation CLI and the dependency-free server SDK have also been implemented locally.
That CLI writes `publisher.granted` and `publisher.revoked` audit records to administrator change history (`admin_changes`) in the same D1 batch
as the publishing authorization write, and `0008_publisher_history.sql`
broadens the history actions. The change history read API and administrator screen also display those actions. The administrator API that changes
publishing authorization (`PUT` and `DELETE /v1/projects/{projectId}/publishers`) and the owner-only
`LivePublishers` screen in settings have been connected locally. The source-specific read API (optional `source`, default browser) has been
implemented and verified locally. Real publisher OIDC provider settings do not exist yet, and the server-source read screen has been
connected locally. This document separates what is finalized from what is still planned.

Shapes follow [OpenAPI](../../api/openapi.yaml), storage structure follows [DBML](../../db/schema.dbml), and
behavioral semantics follow the [Event and Aggregation Contract](./event-contract.md). The browser ingestion route is in
[Collector Implementation](./collector.md) and the [Browser SDK](./browser-sdk.md).

## Included in the Core Slice

- `parseServerBatch` and `prepareServerBatch` in the core. They validate batch structure, time range, and registered definitions with the
  same rules as browser `parseBatch` and `prepareBatch`, then normalize and sort events.
  They live in `packages/core/src/batch.ts`, `types.ts`, and `value.ts`. `parseServerBatch` only
  validates the contract; it does not perform publisher authentication or project authorization.
- Per-source payload hashes. The source is part of the receipt key and hash input, so a server event does not use the same hash bytes as a
  browser event. The browser canonical hash input remains byte-for-byte unchanged.
- Server support in `planIngest`. This pure function creates only receipt and event daily aggregate deltas and does not create
  attempt or workflow state.
- The `ServerBatch` and `ServerEvent` contracts, together with their OpenAPI schema, examples, and tests.

## Included in the Storage and Publishing Authorization Slice

- The `project_publishers` table. Migration 0006 contained only `(project_id, issuer, subject, created_at)`;
  the current definition also includes the immutable grant ID `grant_id` added by 0009. A newly applied database starts with an empty
  table. Publishing authorization is not created from existing administrator grants (`project_grants`), and no backfill is performed. Administrator
  reader or owner status and publishing authorization are independent, and an owner does not automatically receive publishing authorization.
- `0006_server_collection.sql`. It adds `project_publishers` and broadens the source constraint on `event_receipts` and
  `event_daily_counts` from `browser` to `browser|server`. SQLite cannot alter a CHECK directly, so it copies and recreates both
  tables. Migration 0009 adds `grant_id` to the publishing authorization table and recreates it again.
- `publisherAccess` and `commitServer` in the storage adapter. `D1Store` implements `ServerCollectionStore` and owns
  server batch storage.
- The core `ServerPrincipal` (issuer and subject) and `ServerCollectionStore`. They represent the publisher principal verified and passed by
  the host and the `publisherAccess` and `commitServer` ports.

## ServerEvent Contract

`ServerEvent` is a closed object with only four fields.

- `eventId` — A lowercase UUIDv4 newly created for each new event. Retries resend the original eventId, occurredAt, and content unchanged and do not
  create a new ID. Do not reuse an ID for another event.
- `name` — An event name registered for the project.
- `occurredAt` — UTC RFC3339 `Z` on the real calendar, with 0 to 3 fractional-second digits, normalized to
  milliseconds.
- `properties` — Only properties in the registered definition. Booleans, enums, and integers and the limit of 4 properties per event are
  the same as for browser events.

It does not include `attempt`. If a server event has an attempt, the whole batch is rejected.
Source is determined for the whole batch, and `source` is `server`. A batch has at most 20 events and 16 KiB of UTF-8;
`occurredAt` is allowed only from 24 hours in the past through 5 minutes in the future relative to receipt.

`name` is selected only from a registered definition whose source is `server`. Sending a server event through a browser definition or a browser event through
a server definition is rejected. In v0.1, workflow definitions support only the browser source, so a server event cannot be a workflow step.

A schema requires at least one event and can be registered with server definitions only.
A server-only schema uses an empty workflows array. It can also use an empty `allowedOrigins`; in that case browser ingestion is rejected with
`origin_denied`, while server publishing continues to check dedicated authentication and publishing authorization. Browser `summary` for that schema
returns `events=[]` and `totalEvents=0`, and browser workflow reads return 404.

## Duplicates and Hashing

The receipt key is project, source, and eventId. The payload hash is the SHA-256 of the project, schema version, source, and
the complete normalized event. Its canonical input format matches the browser, and server events use null in the final attempt slot.
Server hashes contain no attempt identifier or content.

- The same key and content are counted as duplicates and create no new receipt or aggregate.
- The same key with different content or a different schema version rejects the whole batch with `event_conflict` (409).
- Repeating the same eventId within a batch returns `invalid_event` (422).
- Batches are processed in occurredAt and eventId order.

The browser canonical hash input does not change. It produces the same value when compared with already stored browser receipts.

## planIngest Scope

`planIngest` is an I/O-free pure function. Because it compares receipts in the input snapshot by event_id,
the caller must include only receipts belonging to that project and source. For a server batch it creates only receipt and event daily aggregate
deltas and no attempt or workflow state. The storage adapter filters receipts by project and source and reads the UTC daily usage by project
without source separation before passing it in.

## Storage Structure and Source Separation

- The source of `event_receipts` and `event_daily_counts` accepts `browser` and `server`.
  Source is part of the receipt and aggregate keys, so the same date, event, and properties are different rows when the source differs.
- `workflow_attempts` and `workflow_daily_counts` keep their browser-only constraints.
  Server events do not create attempt or goal state.
- Reads handle one source at a time. Browser and server counts are never combined and double-counted.

## Server Commit and Publishing Authorization

Server batches are stored through a route separate from administrator read and settings authorization.

- `publisherAccess` checks only the project and publisher principal's `project_publishers` row.
  An invalid project ID or publisher format, or an absent row, returns `forbidden` (403); a read failure returns `storage_unavailable` (503).
- `commitServer` reads the publishing authorization row together with the project, schema, source receipts, and UTC daily
  usage in one consistent-read batch. If that read finds no authorization, it returns `forbidden` (403) before writing.
  The write CAS batch checks the same publishing authorization again with `EXISTS`.
- If the publisher row is deleted between read and write, the CAS fails and rolls back the whole batch; a reread without authorization
  returns `forbidden` (403).

The browser storage route rejects server batches with `invalid_request` (400), while `commitServer` rejects a batch containing an attempt or
workflow with `invalid_event` (422). Because authorization checks and storage share one
transaction, a race with publisher revocation leaves no partial write.
`project_publishers` holds the publisher principal (issuer and subject), creation time, and a nonsecret grant ID (`grant_id`) that distinguishes
revocation and regrant. Event input, raw events, and publisher tokens are not stored.

The host (the collector HTTP boundary) passes only a principal whose signature, issuer, audience, and exp have been verified. The dedicated
endpoint, publisher verifier, and `PUBLISHER_*` runtime wiring have been implemented, but the default is `disabled`.
On a deployment that has not enabled publisher authentication, this contract alone does not open server publishing. Publisher
tokens are not stored and are used only while handling the request.

## Quota

Per-minute admission and the project's UTC daily new-receipt limit are shared by browser and server.
The two sources divide the same per-minute and daily budget for a project; they are not calculated separately.
Retransmitting the same ID still consumes the per-minute request limit. A duplicate with the same content does not increase the UTC daily new receipt
count or event aggregates.

## Server Publishing Endpoint

Only `POST /v1/projects/{projectId}/server-batches` is opened. It uses a request boundary different from browser ingestion.

- Authentication uses only the `Authorization: Bearer` header. The header is 8192 characters or less and must have the correct format;
  only a publisher principal (issuer and subject) whose signature, issuer, audience, and exp have been verified passes.
  The host injects the verifier through `PublisherAccess{store, verifyBearer}`.
- If the host does not supply a publisher verifier, this route returns `unauthorized` (401). It does not substitute the administrator verifier
  and has no fallback. A verifier that throws or returns null also produces 401.
- A passing principal is checked for format again, then only issuer and subject are copied to the storage port.
  Tokens and claims are neither stored nor included in the response.
- Authorization check precedes project read and per-minute admission. A request rejected at the initial authentication or publishing authorization
  stage does not consume the project's per-minute quota. Invalid and duplicate requests after authentication consume per-minute admission in the same way as
  browser ingestion.
- This route does not support CORS. `Origin` is not used for authentication, is ignored, and is not reflected in an
  `Access-Control-Allow-Origin` response header. It does not handle `OPTIONS` preflight.
  A method other than `POST` returns `invalid_request` (405) with `Allow: POST`.
- The body must be `application/json`. Another media type returns `invalid_request` (415).
  Query parameters return `invalid_request` (400). The 16 KiB and 20-event limits and field
  checks follow core `parseServerBatch` and `prepareServerBatch`.
- An unregistered or different-source name is rejected, and a paused project returns
  `project_unavailable` (403). An unknown project returns `forbidden` (403) rather than 404 to hide
  whether the project exists.
- D1 `commitServer` checks publishing authorization again at storage time. The UTC daily new-receipt limit and
  per-minute admission are shared with the browser, and an over-limit 429 includes `Retry-After`.

### Factory Wiring

- `createWorker(adminVerifier?, publisherVerifier?)` — Accepts administrator and publisher verifiers separately.
  Without a publisher verifier, only the server route is closed.
- `createOidcWorker(adminOptions, publisherOptions?)` — When both are supplied, their audiences must differ;
  equal audiences are rejected at creation.
- `createPublisherOidcWorker(publisherOptions)` — Publisher only. It does not open administrator routes.
- The default export attaches no verifier, so both administrator and publisher routes are closed with 401.
- The publisher OIDC verifier is created with `exclusiveAudience`. After signature verification, it passes only when `aud` is one audience
  string or a one-element array containing that value; a token containing another audience is rejected. The administrator verifier keeps the
  existing `includes` policy.
- Authentication reuses the existing jose-based verification in `packages/auth-oidc`.

The publisher verifier is injected by the host. If publisher authentication is not enabled in deployment settings (the default
`disabled`, including existing deployments without publisher settings), the server route stays closed with 401. Real publisher
OIDC provider values and remote registration and deployment have not been added.

## Migrations and Rollback

`0006_server_collection.sql` adds `project_publishers` and copies and recreates `event_receipts` and
`event_daily_counts` to broaden the source constraint. Because table copying is large, production application requires a brief ingestion pause and backup,
followed by validation of row counts, schema, and foreign keys before and after. The procedure and checklist are in the
[application notes](../../db/migrations/README.md). No production database backup or application was performed when this document was written, and it has not been applied to remote D1.

To roll back, restore the previous browser code and leave the expanded tables in place. Do not delete stored server rows for rollback.
Disable server ingestion and do not open server-source reads.
Do not delete `project_publishers` authorization either.

`0008_publisher_history.sql` copies and recreates `admin_changes` to add
`publisher.granted` and `publisher.revoked` to the action constraint. Its 13 columns, existing rows, indexes, and triggers remain
unchanged, and no backfill is performed. Apply it in one batch while administrator API and provisioning CLI writes are stopped,
then compare row counts, schema, and foreign keys before and after. If rollback is needed, leave the expanded schema in place, but do not put an older administrator history reader
that cannot interpret the new action back over new rows. Prefer fixing forward over restoring an older reader.

`0006` is applied in one batch. The storage adapter test also forces the final statement of 0006 to fail and confirms that existing rows, constraints, and markers
roll back.

## Publisher Authorization CLI

`project_publishers` grant and revocation were implemented locally in the offline provisioning CLI as `publisher-grant` and
`publisher-revoke`. They accept only closed JSON `{projectId, issuer, subject}`, and issuer and subject are checked with the core
`validGrantIdentity`. There is no role or project limit. If the project does not exist, preview stops with `project_not_found`. The default is
preview, and only a reviewed plan is applied with `--apply` and `--expect-plan`. Plan output includes a `principalHash` instead of raw identifiers,
and compares project creation time and current authorization state with CAS.

This command changes only publishing authorization and history; it does not touch administrator `project_grants`, check the last owner, or issue
credentials. Application writes the authorization row and records administrator change history (`admin_changes`) in one D1
batch. If history storage fails, the authorization change in the same D1 batch rolls back. Running it again when the desired state already exists
writes nothing and ends as a no-op, so no new history is left. Because this is a CLI change rather than an API change, the actor is
`local_operator` without identifiers. `0008_publisher_history.sql` broadens the actions for this history, and the publishing authorization table is
recreated by `0009_publisher_generations.sql` with `grant_id`. Detailed formats are in
[Registration and Authorization Management CLI](./provisioning.md).

## Server SDK

`@tallyfin/server` (`packages/server`) implements the server publishing client locally. When the host supplies
`createTallyfinServer` with an endpoint, reviewed server schema, and `getToken`, `createEvent` freezes an eventId, UTC occurredAt, and
properties, and `send` transmits one batch of 1 to 20 events and at most 16 KiB.
Retry, cancellation, receipt, and retransmission rules are in the [Server SDK](./server-sdk.md); choosing the real issuer and
issuing credentials are the host's responsibility.

## Administrator Publisher List

`GET /v1/projects/{projectId}/publishers` requires an administrator bearer and the current project owner grant.
A `project_publishers` grant alone cannot read it, and a reader receives 403. A missing project or revoked owner authorization also returns 403;
each page reads authorization and rows in the same D1 batch.
Paused projects and projects without a schema are readable through this control-plane route.

The response is `{projectId,data,page}`, and each row contains issuer, subject, grantId, and createdAt.
`grantId` is not a credential; it is a nonsecret concurrency marker that distinguishes revocation and regrant. The response does not return tokens, profiles, or
email. The default limit is 25 and the maximum is 100, ordered by SQLite BINARY order of issuer and subject.
The base64url cursor is a position tied to the project and publishers-list kind, at most 12,288 characters; the full query is at most 12,352 characters, and it rejects
cursors from another project or grant list and duplicate or extra parameters. The position survives row deletion; if new rows are inserted before the cursor, refresh
from the first page. Cache-Control is no-store, and GET is the only accepted method with no CORS, cookies, or writes. Authentication failure is 401,
invalid input 400, other methods 405 (`Allow: GET, PUT, DELETE`), and storage failure or corrupt data
returns 503. PUT and DELETE follow the registration and revocation rules below, while GET behavior itself is unchanged.
A publishing authorization change made by the CLI appears in administrator change history as `publisher.granted` or `publisher.revoked`.

## Administrator Publisher Registration and Revocation

`PUT /v1/projects/{projectId}/publishers` grants publishing authorization, and
`DELETE /v1/projects/{projectId}/publishers` revokes it. Both require an administrator bearer and the current project
owner grant. Readers, owners of another project, revoked owners, and nonexistent projects return 403, and a principal that has only
`project_publishers` publishing authorization also returns 403. Before reading the body, the router checks whether the caller is owner;
immediately before writing, the atomic D1 batch performs the owner check, authorization write, audit record, and result read together.
Every write statement in the batch also carries the owner `EXISTS` condition, so if the owner is revoked between reading the body and executing the batch,
the write affects zero rows, nothing changes, the owner read is empty, and the response is 403.
Revocation relies on the condition blocking the write rather than exception rollback.

- The PUT body contains only `{issuer,subject}`, and the DELETE body is `{issuer,subject,expectedGrantId}`.
  There is no role, credential, or additional field. Issuer and subject follow the core `validGrantIdentity`, and the
  project ID format is also checked.
- `expectedGrantId` is the immutable grant generation last read, as a 32-character lowercase hex string or null.
  Null means the caller observed no authorization. A request with granted true does not accept expectedGrantId.
  Sending the former `expectedCreatedAt` field returns 400.
- The body accepts `application/json` and `text/plain`; over 16 KiB returns 413, and another media type or
  nonidentity encoding returns 415. Query parameters return 400.
- The response is `{projectId,issuer,subject,granted,grantId,createdAt,changed}`. `granted`, `grantId`, and
  `createdAt` are paired. A grant is true with the grant ID and creation time; revocation is false with null values, and
  credentials and roles are not included.
- Granting an existing publishing authorization again returns `changed=false` without changing the existing row or `grantId`.
  If the target grant row is absent, the operation is a no-op with `changed=false` regardless of `expectedGrantId` (whether the ID just read or null).
  After revocation, resending the same valid ID or null also succeeds as a no-op because the row is already absent. It returns
  `changed=true` only when the row remains and its stored `grant_id` equals `expectedGrantId`.
- The revocation CAS compares `expectedGrantId` with stored `grant_id`; a mismatch returns
  `publisher_conflict` (409), and the caller must read again. A new `grant_id` is assigned on every regrant, so
  grants regranted in the same millisecond remain distinguishable. The `immutable_publisher_generation` trigger prevents row
  UPDATE, so revocation deletes and granting reinserts.
- Audit records (`publisher.granted` and `publisher.revoked`) share the D1 batch with the authorization write and are inserted only when the preceding
  write changes one row. A no-op (duplicate grant or no target) performs neither the authorization write nor a history
  addition. If the audit INSERT fails after one row changed, the same batch rolls back the authorization change. Resending the same request leaves no new history.
- Status codes are 200, 400, 401, 403, 405, 413, 415, and 503, with 409 added only for DELETE. The 405 `Allow` header is
  `GET, PUT, DELETE`.

The owner-only `LivePublishers` in settings is connected locally between `LiveGrants` and `LiveAdminChanges`.
It provides a 25-item list, next page, refresh from the beginning, grant by issuer and subject, and revocation with the observed `grantId`, and writes only after
explicit confirmation. On conflict it rereads the latest list, and when the result is uncertain it retries the original
request unchanged. An in-progress write with an uncertain result locks the settings form and grant changes, and
existing administrator change history refreshes after storage. Cancellation, late-response discard, and identifier clearing on authorization denial or project switch are applied. Screen behavior and local browser checks are in the [Administrator Boundary](./administrator.md#publisher-management-screen).
A real Chrome, temporary OIDC, and local D1 smoke test and 19/19 focused administrator checks, 153/153 API and model checks,
administrator type checking, build, bundling 2/2, and sites 9/9 passed locally. Detailed results are in
[VALIDATION.md](../../VALIDATION.md).
The CLI (`publisher-grant` and `publisher-revoke`) remains usable.
This API does not issue credentials or change administrator grants. The database uses `grant_id` from 0009, and audit uses the 0008 action.
This slice did not apply to a remote database or push or deploy.

## Server-Source Reads

`GET .../summary` and `GET .../events/{eventName}/daily` accept optional `source` (default browser;
browser or server). A request reads only one source and never combines browser and server counts.
Server definitions also support daily property classification. If that source has no definition, summary returns `events=[]` and
`totalEvents=0`, and daily for a name present only in another source returns 404. Workflow reads are browser-only and do not accept
`source`. Read authorization is checked only against administrator `project_grants` reader or owner;
`project_publishers` publishing authorization cannot read. `meta.latestReceivedAt` is the project-wide latest receipt time
regardless of source, version, or date. The screen is connected locally and local browser verification is complete.

## Not Yet Decided

- Production application of conversion from a browser start to a server completion. The contract, definition registration, publication, and reads in the
  [ordered task funnel contract and core](../adr/0006-ordered-task-funnels.md), linkage event
  ingestion and storage, [browser profile](./browser-sdk.md) and [server SDK](./server-sdk.md) transmission, and
  `GET .../funnels/{funnelId}/daily` and `.../breakdown` reads and the administrator screen (property classification, previous-period comparison, and CSV)
  have been implemented and verified locally ([verification record](../../VALIDATION.md)). What remains is confirming them with production data in a service pilot.
- Publisher OIDC production settings, real audience values, and issuance procedure. The only decision so far is not to reuse public project IDs and
  allowed origins as publisher authentication. Finalizing the production provider and audience values is deferred until the user chooses the production authentication method.
- Whether to have separate per-minute and daily limits by source. Currently the project shares one value.
- Production deployment and production authentication connection for the server-source read screen. The screen is connected locally and local browser verification is complete.

## Next Slice

1. Production OIDC settings and provider connection. After the user chooses production authentication, finalize the publisher audience and remote
   registration, then enable the server route.
2. Register the remote Worker, D1, and Cron Trigger and deploy to production.
3. Production backup and restore. Local synthetic recovery drills are complete; a real production database backup and remote recovery have
   not been run.
4. The first Sembom pilot and a pilot for a service of a different kind. There is no real integration or activation yet, and the second
   service is undecided.

Related: [Event and Aggregation Contract](./event-contract.md), [Collector Implementation](./collector.md),
[Administrator Read and Settings Boundary](./administrator.md), [application notes](../../db/migrations/README.md),
and [OpenAPI](../../api/openapi.yaml).
