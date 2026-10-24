# Tallyfin

Tallyfin is a lightweight product event analytics platform shared across Rodisoft services. Per-project configuration counts different actions such as sign-ups, file conversions, purchases, and calculations while minimizing personal data collection. Sembom is the first integration example.

This document is a guide for readers who want to download the project and try it locally. The production identity provider, remote database, domain, and license are still undecided, and no production deployment or service pilot has taken place.

## What works locally now

- `packages/core`: registration definitions, browser/server batch validation, time normalization, and SHA-256 input.
- `packages/storage-d1`: an adapter that atomically applies D1 receipts, attempts, quotas, aggregates, and server publish permission. Publish permission changes are processed in the same batch as administrator change-history audit records.
- `apps/collector`: a minimal native-fetch browser collector, administrator GET queries, a server publishing endpoint, a publisher permission grant and revoke API, and publisher authentication wiring.
- `packages/browser`: a dependency-free browser SDK with batched delivery, bounded retries, and delivery while the tab is hidden.
- `packages/server`: a dependency-free server publishing SDK with `createEvent` and retrying batch `send`.
- `packages/auth-oidc`: an OIDC JWT verifier for administrators and publishers.
- `apps/admin`: project overview, event analytics, settings, goals, and funnel screens; browser/server source selection queries; permission viewing and changes; owner-only publisher management in settings (`LivePublishers`); administrator change history; own-account lookup; and public-client OIDC PKCE login code. The funnel step edit form and funnel CSV are also connected locally.
- `db/migrations`: `0001_initial.sql` and `0002` through `0014`. Migration 0007 adds multi-step funnels (`funnel_runs` and `funnel_daily_counts`); 0008 recreates `admin_changes` to add the publish-permission audit actions (`publisher.granted` and `publisher.revoked`); and 0009 recreates `project_publishers` to add the immutable grant ID `grant_id` to publish permissions. 0010 adds the administrator permission revision, and 0011 adds analytics lookup indexes. 0012 adds completion duration, 0013 adds optional failure-reason aggregates, and 0014 adds `project_schema_drafts` for shared schema drafts. There are now 14 migrations and 17 tables.

Funnels with 2 to 10 steps are implemented locally through registration, validation, publishing, and definition lookup, and the browser and server collection paths store linked events in the same D1 batch as receipts, quotas, and aggregates. Cleanup of 72-hour connection state and 90-day step aggregates was also verified locally. Server publishing is implemented and verified locally from core validation through the dedicated `POST /v1/projects/{projectId}/server-batches` endpoint, publisher OIDC verification wiring, the publisher permission grant and revoke API (`PUT` and `DELETE /v1/projects/{projectId}/publishers`), the `publisher-grant` and `publisher-revoke` CLIs, and the server-source query screen. Both the API and CLI record audit rows for publish-permission grants and revocations in the administrator change history within the same D1 batch, and rerunning either one does not create a new history entry when the desired state already exists.

The owner-only `LivePublishers` settings screen provides a 25-item list with pagination and lets owners grant and revoke publish permissions. Writes are sent only after explicit confirmation, and revocation sends the immutable grant ID (`grantId`) observed in the list as a CAS condition so it does not remove a permission re-granted in the same millisecond. People see the grant timestamp table as-is, and grant IDs are not shown in the interface. Conflict recovery, retrying the original request, settings and grant locking, and change-history refresh are implemented. It passed a real Chrome test, a temporary OIDC and local D1 smoke test (a stale revocation returns 409 after a re-grant in the same millisecond), administrator checks, type checks, the build, 2/2 bundle checks, and 9/9 Sites checks. Detailed results are in the [validation record](VALIDATION.md).

## What has not been verified yet

- The production identity provider, remote D1, domain and deployment, service pilot, and license are undecided or have not been run.
- No production values exist yet for publisher OIDC, and sign-in through a real provider has not been verified.
- Local load, cleanup, and recovery experiments have been verified. Remote migrations, cleanup Cron jobs, backup and recovery, and production SLOs have not been verified; the production SLO is UNDECIDED.
- The API 401 shown under the administrator's default settings is a real response returned while authentication is disabled. Real sign-in requires separate OIDC configuration.

## Running locally

Node 24 or later is required, and dependencies are installed from the repository root lockfile. Run the commands below from the repository root.

```sh
npm ci --ignore-scripts
npm run provision -- init --local --state-dir .tmp/collector-db --apply
npm run provision -- register --local --state-dir .tmp/collector-db --file api/examples/registry.json --apply
npm run dev -- --local --state-dir .tmp/collector-db
```

The administrator runs at `http://127.0.0.1:5180` and the collector at `http://127.0.0.1:5188`. The 2 ports must differ, and startup fails if either is already in use. For ports, configuration, and shutdown, follow the [integrated runtime guide](docs/backend/runtime.md#integrated-development-run).

Administrator and publisher authentication are disabled in the default configuration, so both the administrator API and `POST /v1/projects/{projectId}/server-batches` return 401. The administrator `/` page (`http://127.0.0.1:5180/`) therefore shows a notice that administrator login is not configured, and its sample-demo tour link opens the `/demo` sample screen. The return-to-administrator-login link in the demo banner goes back to `/`, and the sample numbers and edits are separate from production data, so they do not change the real API or database. You can also open `/demo` directly. Real sign-in and real data queries require separate OIDC configuration, and registration, permission grants, and migrations do not happen automatically.

Run repository checks with `npm run check` at the root (type checks, tests, and the browser SDK size budget).

Check the SDK's local distribution files with the optional `npm run verify:sdk-packages` command. It packs 2 SDKs as tarballs, installs them offline outside the workspace, and checks the file list, types, and ESM entry points. No package is published and no version changes; follow the [package verification guide](tools/sdk/README.md).

You can verify server SDK retry after failure, deduplication, and publisher revocation locally with `npm run verify:server-recovery`. It passed with exit code 0 and `verified: true` in a Miniflare loopback test, including retrying the same body sent through real `fetch`, having the collector deduplicate it, and returning `403` after publisher revocation. The final check queries D1 SQL directly for `SUM(count)` per event equal to 2, two `funnel_runs` rows, and the 4-step `step_times_json` for 2 runs. Remote D1 and real publisher sign-in are out of scope. See [server SDK recovery verification](tools/runtime/SERVER-RECOVERY.md).

## Production installation and checks

[Installation setup preparation](docs/backend/installation.md) collects production configuration preparation and checks (`install:setup`, `install:prepare`, `admin:build-configured`, `install:check`, `install:database-check`, and `install:access-check`). `install:setup` asks only for public configuration values in an interactive terminal and writes the same 5 files as `install:prepare` into a new directory. These commands generate configuration files, build the administrator app, and check the public provider, remote database metadata, and administrator read access. The 3 checks cover different targets, and none of them means production readiness is complete. They do not automatically perform remote writes, sign-in, or deployment. Details are in the [installation check guide](tools/runtime/INSTALL-CHECK.md) and the [access check guide](tools/runtime/INSTALL-ACCESS-CHECK.md). The operator decides the real resource values and authentication settings, then runs them separately.

The [release runbook](docs/ops/release.md) and [rollback runbook](docs/ops/rollback.md) describe the actual first-install, upgrade, deployment, and rollback procedures. Remote deployment, migrations, and backup and restore are run manually after approval and have not been run in a real environment.

To summarize production logs, pass application NDJSON on standard input (`node tools/runtime/summarize-observations.ts --stdin`; on Windows, `npm.cmd run --silent logs:summary -- --stdin`). The tool aggregates the seven fixed `http_request` fields and scheduled-cleanup logs, and its `diagnostics` section separates observed errors, rejections, and cleanup failures from items that still need checking. The report omits `requestId`, project IDs, and raw text. Usage and limitations are in the [log summary guide](tools/runtime/LOG-SUMMARY.md).

For captured Wrangler tail JSON, use `--stdin --wrangler-tail` on the same CLI. It extracts application console records from multi-line objects and produces the same report while discarding URLs, headers, and exceptions. Input must be a finite log that finishes within 30 seconds, and no remote log session is opened automatically.

The administrator-only `GET /v1/health` endpoint uses a verified administrator bearer token to check the read state of 2 control tables. A successful response is `{status:"ok",scope:"administrator_storage_read"}`, and it does not confirm collection writes or cleanup execution. The query is read-only and returns no raw rows, accounts, or project information. Scope and errors are described in [production observability](docs/ops/observability.md). Recurring execution and production authentication configuration are not connected yet.
`install:access-check` also checks account resolution, then this read probe, then project queries, and it does not issue later requests when an earlier step fails.

`monitor:access` runs the same authenticated access check once per invocation and outputs alert intent when a problem opens or recovers, based on the specified state file, failure and recovery counts, and maximum observation interval. The operator connects actual scheduling, token delivery, and notification delivery. Follow the [recurring access check guide](tools/runtime/ACCESS-MONITOR.md).

The Storage read check in administrator settings also runs the same read check from a button and shows the check time. The request is cancelled after 5 seconds, and closing the screen or replacing the connection clears the previous result. It was verified with local Chrome and D1 without automatic polling, and real production authentication and remote status checks are still absent.

The browser login flow can be verified separately with `npm run verify:admin-login -- --channel chrome`. It uses an isolated provider response and local D1 to check the PKCE redirect, callback, API queries, token refresh, and sign-in again. Playwright setup and output scope are in the [login verification guide](tools/browser-bench/ADMIN-LOGIN.md).

The browser onboarding flow can be verified separately with `npm run verify:admin-onboarding -- --channel chromium` after `npm run build:browser`. It checks an actual sign-in from an empty project list, UI project creation, publishing of the first schema (v1), actual delivery by the generated browser SDK code, 1 D1 aggregate, 1 administrator event row, and the 3 onboarding step transitions against an isolated local D1. It does not write to remote services. Playwright setup and output scope are in the [onboarding verification guide](tools/browser-bench/ADMIN-ONBOARDING.md). With `--lost-responses`, it also severs the response after saving creation and publishing, then checks whether explicit confirmation in the interface recovers the draft and the first event query.
Permission denial and recovery, and project switching or disconnection during a save, are verified separately with `npm run verify:admin-access -- --channel chromium`. Follow the [access verification guide](tools/browser-bench/ADMIN-ACCESS.md).

Administrator settings also include an Operations log report that reads a `logs:summary` JSON file. The browser Worker validates reports up to 8 MiB and shows errors, responses, and cleanup records in a table. It uses the file without uploading or storing it, and the report scope is kept distinct from the project and date filters. See the [usage guide](docs/ops/local-report-viewer.md).

## Documentation

- Product: [overview](docs/product/00-product-brief.md), [specification](docs/product/02-spec.md), [roadmap](docs/product/01-roadmap.md)
- Design: [architecture](ARCHITECTURE.md), [screen design](docs/frontend/FRONTEND_DESIGN.md), [ADR 0004](docs/adr/0004-general-product-analytics.md), [ADR 0007](docs/adr/0007-admin-application.md)
- Contracts and implementation: [events and aggregates](docs/backend/event-contract.md), [collector](docs/backend/collector.md), [browser SDK](docs/backend/browser-sdk.md), [server SDK](docs/backend/server-sdk.md), [server publishing](docs/backend/server-events.md), [administrator query boundary](docs/backend/administrator.md), [OIDC](docs/backend/oidc.md)
- Integration and validation: [Sembom example](docs/integrations/sembom.md), [performance targets](docs/engineering/03-performance-budget.md), [validation record](VALIDATION.md)
- Operations: [release runbook](docs/ops/release.md), [rollback runbook](docs/ops/rollback.md), [incident response](docs/ops/incident-response.md), [operational contract](docs/ops/00-operational-contract.md), [secrets](docs/ops/secrets.md), [backup and recovery](docs/ops/backup-and-restore.md), [production observability](docs/ops/observability.md)
- Apps: [administrator app](apps/admin/README.md), [integrated runtime and deployment](docs/backend/runtime.md)

## Out of scope

Raw input, persistent visitor identifiers, implicit DOM collection, infrastructure telemetry, session replay, and advertising attribution are out of the initial scope. SQL migrations have been applied only in local Miniflare tests, never to a remote database. `0006_server_collection.sql` copies and recreates receipt and event aggregate tables, so applying it in production requires stopping collection, taking a backup, and verifying row counts. `0008_publisher_history.sql` also copies and recreates `admin_changes`, so it must be applied in one batch while administrator API and CLI writes are stopped, with row counts, schema, and foreign keys checked before and after. `0009_publisher_generations.sql` copies and recreates `project_publishers`, so publisher CLI and HTTP writes must be stopped, a backup taken, the migration applied in one batch, and publisher row counts and per-row grant IDs checked before and after.

The SDK alone targets 3 KiB gzip, and the combined total of a service's integration code and required configuration targets 3.25 KiB gzip or less for the representative example. This budget does not cover a whole host app or the combined settings of every project. It is a local measurement, not a production figure.

## Delivery diagnostics and size budget — 2026-10-23

The browser SDK uses an optional synchronous onDelivery(state, events) callback to distinguish HTTP acceptance, retry, final failure, deadline expiry, queue overflow, discard by destroy, and acceptance into the host beacon queue. It does not pass event contents or IDs. Callback exceptions and re-entry do not change delivery state. The SDK-only budget remains 3 KiB gzip. The budget for representative integration code and required configuration including delivery diagnostics is adjusted to 3.25 KiB (3,328 B). Because the existing reference example was already close to 3 KiB, this explicitly allows about 130 B of extra code cost instead of removing diagnostics or reducing verification. This paragraph supersedes the earlier 3 KiB full-integration target and past measurements.
