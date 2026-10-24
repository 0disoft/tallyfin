# Validation History 12

This historical record preserves the section order of the original. Commands and code paths are relative to the repository root.

## Authenticated server-event ingestion API — 2026-10-11

Connected `POST /v1/projects/{projectId}/server-batches` to a separate publisher verifier. Publisher permission, independent of admin grants, is checked before admission, and the existing commitServer checks it again immediately before writing. The endpoint uses the same per-minute and UTC daily limits as the browser, enforces JSON only, 16KiB, 20-event limits, POST only, rejection of queries, no CORS, and ignored Origin; it supports same-ID retries and rejects a conflicting item in the batch. It closes with 401 by default. Connected `PUBLISHER_AUTH_MODE` and separate `PUBLISHER_OIDC_*` settings to the runtime, and server tokens accept only a single audience. Configuration is rejected at setup time if admin and publisher audiences are identical. Older configurations without publisher variables continue to operate as disabled.

Root `npm run check` passed typecheck, all 218/218 tests, and the browser SDK size check. The 6/6 new HTTP tests verified authentication and storage using actual Miniflare Worker/D1, an in-memory temporary RSA signature, and an isolated public JWKS transport. They verified rejection of admin tokens, multiple audiences, an invalid issuer, expiration, and a tampered signature; rejection of publication with owner permission only; a private 403 for an unregistered project; the period before and after publisher permission revocation and revocation before storage; duplicates, conflicts, and shared quota; and rejection of invalid methods, media type, UTF-8, size, schema, source, and attempt input. An initial authentication or publisher-permission failure does not use admission, while a subsequent invalid request uses quota. OpenAPI lint passed with no warnings and contract checks passed 42/42. SDK gzip remained 2667 bytes and 2949 bytes including the Sembom example, within the 3072-byte budget.

Changed the OpenAPI request path and publisher security scheme, product specification, roadmap, ingestion/server-event documentation, OIDC documentation, and runtime documentation. Did not change DB structure, migrations, the browser SDK, dependencies, CI runner, or hygiene policy. Because no UI changed, UI build and browser-screen verification were skipped, and there is no general source lint script. Actual provider credential issuance, remote DB, load, deployment, and Sembom activation were not run. Publisher permission tooling, the server SDK, server-source lookup, and server-only registry support are later work.

## Owner-only change-history lookup API — 2026-10-11

Connected `GET /v1/projects/{projectId}/changes`, the core AdminChangePage/AdminStore.changes type, and a D1 reader. It checks the current owner and records in the same batch and reads newest by time and UUID descending, 25 by default and up to 100. A project-bound cursor of up to 512 characters contains only record time and UUID, with no account information or permissions. Even when physical cleanup is delayed, records outside the 90-day rolling window based on request time and future records are excluded. It distinguishes an API actor from a CLI actor without an identifier, projects only the minimum fields for each action, and returns recorded-changes-only, creation time, and retention period.

Root `npm run check` passed typecheck, all 199/199 tests, and the SDK size check. Related HTTP/existing admin tests passed 19/19 first, and the added maximum-page check was included in the full run above. On actual Miniflare D1, verified pages at the same time and re-lookup after deleting the cursor row or adding a new record; default/maximum limits; retention boundary, hiding expired rows, and isolation from other projects; reader/revoked permission and revocation immediately before writing; invalid cursor/query/method; and 503 with a private error for corrupted data. Extended the existing native Worker smoke to cover change-history lookup, next-page navigation, and 403 after grant revocation; it passed. OpenAPI lint, contract checks 39/39, and `git diff --check` passed. SDK gzip remained 2667 bytes and 2949 bytes including the example.

Changed OpenAPI and examples, the core storage port, DBML lookup-retention description, and admin/product documentation. Did not change DB structure, SQL migrations, SDK, dependencies, CI runner, or hygiene policy. Screen integration is the next step, so UI build and browser UI checks were not run. Remote D1, production OIDC, load, push, deployment, and Sembom activation were outside this scope.

## Admin change-history storage — 2026-10-11

Added per-project control-plane history in `0005_admin_changes.sql` and DBML. API project creation, settings change, schema publication, and grant changes, plus local Provisioner registration, settings, schema state, and grant changes, insert history in the same DB batch as the actual write. A settings request with no actual change, a repeated request for the same state, permission denial, and a conflict add no history. The implementation distinguishes a verified admin issuer/subject from the CLI's identifier-free local_operator and does not infer the target of a CLI change as the operator. It retains only the settings field name, schema number, and before/after grant role, excluding settings values, definitions, raw bodies, tokens, and visitor data.

Added 90-day rolling retention and per-project cleanup of 500 rows by default, up to 1000, to the existing scheduled path. It does not backfill past changes and adds no history writes to normal browser ingestion. The DB also enforces the UPDATE immutability trigger, per-action NULL relationships, the allowed settings-field list, and duplicate rejection. The new owner-only lookup API and screen are the next step.

Root `npm run check` passed typecheck, all 192/192 tests, and the SDK size check. After adding the final field-constraint and CLI rollback checks, reran the related D1 tests 6/6 and passed. On actual local Miniflare D1, verified complete rollback when API/CLI history insertion fails, no record on retry/conflict/same value, retention boundary, tenant isolation, deletion limit, upgrade/reapply of an existing DB with no backfill and preservation of original data, and CLI initialization of a new DB. Contract checks 37/37 and `git diff --check` passed. SDK gzip remained 2667 bytes and 2949 bytes including the Sembom example.

Changed DB structure, migrations, and the optional settings-save timestamp on the core storage port. Did not change HTTP request/response shapes, SDK, dependencies, CI runner, or hygiene policy. Because there was no screen change, UI build/browser checks were skipped. Remote migrations, production OIDC, load, and recording direct SQL changes were outside the verification scope. Nothing was pushed or deployed, and Sembom was not activated.

## Admin permission-change screen — 2026-10-11

Connected a collapsed add-account form and per-row role-change/revoke buttons to `LiveGrants`, with `GrantChangePanel` used to review the target identity and old/new role before saving. It warns about the possibility of self-demotion/revocation, and on a lost response rechecks only the same fixed request. Permission loss immediately removes the list and form and locks `LiveSettings` editing. It preserves settings drafts and re-looks up related schema/diagnostic/SDK settings. During settings refresh it retains a pending permission save or unknown result, and discards late responses from a project/connection switch.

Admin `npm run typecheck`, `npm run build`, and `npm run test:sites` 4/4 passed. The full 118/118 test result for the identical-change client was reused from the earlier step, and a real-browser smoke test was run for the UI integration. No general lint script exists, so it was skipped.

In local Vite at 127.0.0.1:5182 and Codex's in-app Chromium, injected synthetic transport into the actual components and verified add/promote/revoke, 0 requests before confirmation, identical recheck after a lost response, rejection of removing the last owner, latest list after a concurrent-change conflict, self-demotion/revocation and 403 locking inputs and removing the row, draft preservation, settings refresh during a delayed save, and discarding a late response after a project switch. Switching to a reader did not increase permission requests and removed the list and add form. After loading final code in a new tab there were no console errors. An earlier HMR error caused by replacing a temporary file during editing was not counted as a runtime error of the final document.

At actual CSS innerWidth 320px, document scrollWidth was 303px and the panel 253px, with no page overflow; the 540px table scrolled only within a 255px region. A 508-character identifier was not truncated, table/confirmation values were 18px, and the table scrolled with keyboard ArrowRight. Restored the viewport and shut down the verification tab/server. Screens are stored in `.tmp/grants-edit-qa/desktop.png` and `mobile.png`.

Updated the product specification, roadmap, frontend design, admin documentation, and validation record. There are no changes to the API, DB, SDK, dependencies, CI runner, or hygiene policy, and nothing was pushed, deployed, or activated in Sembom.

## Server-batch core validation and aggregate planning — 2026-10-11

Added `ServerBatch`, `ServerEvent`, `PreparedServerBatch`, `parseServerBatch`, and `prepareServerBatch`. They share structure, registered-property, and time validation with the existing parser/preparer, allow only server-source definitions, and reject attempts. canonicalEvent now optionally accepts a source while preserving the byte input for the default browser hash. `planIngest` creates only receipt and event deltas for a server batch and creates no attempts or workflows. The HTTP handler and storage adapter are not connected, and the current public browser path still rejects server batches.

On the first run of the new tests, one expected value incorrectly serialized typed dimensionKey values and failed. Aligned the expectation with the existing serialization format in the source and ran root `npm run check`; it passed typecheck, 203/203 tests (including 4 new server-batch tests), and the browser size check. Existing Worker/Miniflare, D1 atomic storage, admin permission, and CLI regressions also ran. SDK gzip remained 2667 bytes and 2949 bytes including the Sembom integration, within the 3072-byte budget.

`tools/contracts` `npm run check` passed 41/41 and `npm run lint` passed. The OpenAPI ServerBatch is not yet connected to an HTTP path, so there is a no-unused-components warning. To avoid hiding that warning, the browser path was not allowed to accept server schemas and the validation rule was not relaxed. Added the ServerBatch/ServerEvent schemas and examples, covering separate sources, rejection of attempts, closed objects, the 20-event limit, and rejection of server input by the existing public browser request schema.

Updated the product specification, roadmap, server-event contract, backend guidance, README, and validation record. Added only component schemas to the API; did not change HTTP paths, authentication, DB, migrations, SDK, dependencies, CI runner, or hygiene policy. The new HTTP server authentication/storage smoke and server-only schema registration are not implemented or run. Nothing was pushed, deployed, or activated in Sembom.

## Server publishing permissions and source-specific storage — 2026-10-11

Added `ServerPrincipal`, `ServerCollectionStore`, and `D1Store.publisherAccess`/`commitServer`. The new `project_publishers` holds project/issuer/subject permission independent of admin reader/owner and grants no permission automatically. Only an identity whose host authentication verification has completed may be passed to this port. The storage adapter does not validate token signatures, audience, or expiry and issues no token. A server commit reads permission and per-source receipts in a consistent read and checks current permission again in the write-batch CAS condition. A revocation race rolls back all writes, and the next lookup returns 403. Browser/server receipts are separate even for the same ID, while the UTC daily quota is shared project-wide.

Migration 0006 copies and recreates event_receipts and event_daily_counts to widen source CHECK to browser|server and restores existing indexes. It adds project_publishers as an empty table. Local initialization checks the new marker and both widened CHECKs together to prevent repeated application and rejects temporary tables or partially applied state. Updated DBML and migration guidance.

The 7/7 new `node --test packages/storage-d1/test/server-collection.test.ts` tests passed, as did typecheck, all 210/210 tests, and the browser size check from root `npm run check`. The tests cover separation from admin permission, project/issuer/subject isolation, source separation for the same ID, retry, conflict, shared quota, permission-revocation race, 20 simultaneous duplicates, complete rollback on aggregate overflow, and retention cleanup. Existing browser, admin, registration CLI, and local-supervisor regressions also ran. SDK gzip remained 2667 bytes and 2949 bytes including Sembom, within the 3072-byte budget.

Verified applying 0001–0006 to an empty Miniflare DB and applying only 0006 to a DB with 0001–0005 browser receipts, aggregates, attempts, settings, and grants. Compared rows immediately before and after the upgrade and verified both indexes, foreign_key_check, 0 new permissions, and no-op reinitialization. When a count=-1 constraint failure was injected at the end of the migration, the original rows and table constraints remained and neither the new marker nor temporary tables remained. An incomplete state with the widened tables but no marker is rejected as partial_database. Table-copy time at production scale and remote D1 were not verified.

`tools/contracts` `npm run check` passed 41/41 and `npm run lint` passed. The 1 warning for the unconnected ServerBatch HTTP component remains. There is no general source lint command. The HTTP server authentication smoke, actual credentials, remote migrations, and production load verification are not connected and were omitted. There are no changes to API paths, existing authentication, SDK, dependencies, CI runner, or hygiene policy, and nothing was pushed, deployed, or activated in Sembom. Also aligned API descriptions, product specification, roadmap, server-event contract, and README with the current scope. Actual OIDC accounts and remote D1 were not used in this UI verification because the environment is not connected.

## Admin permission-change client — 2026-10-11

Added admin `ApiClient.changeGrant` and `GrantEditor`. They validate the project/account/role in the closed PUT/DELETE body and response, and every change requires explicit confirmation after review. A lost response, 503, or response-contract error rechecks only the same request while freezing input. Conflicts and last-owner rejection are displayed as distinct errors; loss of permission or unmount blocks further changes and late responses. There is no automatic resend, identifier storage, or logging.

Related request/controller/existing-list tests passed 13/13; admin `npm run typecheck` and the full `npm test` 118/118 passed. Also verified that a confirmed save with a UI callback failure is not converted into an unknown response. Because UI integration comes later, browser UI smoke and build were not run at this step. There are no changes to the API, DB, SDK, dependencies, or CI runner, and nothing was pushed or deployed.

## Project permission-change API — 2026-10-11

Implemented local owner-only `PUT/DELETE /v1/projects/{projectId}/grants`. It uses the looked-up `expectedRole` to detect concurrent changes and rejects demotion or revocation of the last owner. Permission checking, change, and result lookup are in the same D1 batch; repeating the same target state succeeds without another change. It preserves the existing creation time, and when a caller changes their own permission, the result's `canManage` reflects the owner permission that remains.

Root `npm run check` passed typecheck, all 186/186 tests, and the browser size check. Related tests, combining the 1 new request validation with 8 change-API tests and the 6 existing list tests, passed 15/15. Verified concurrent changes, last-owner protection, permission-revocation races, rejection of another project, repeated requests, and DB-failure rollback, and ran actual PUT/DELETE in the existing Worker smoke. `tools/contracts` OpenAPI lint and contract checks 37/37 passed, along with `git diff --check`. SDK gzip remained 2667 bytes and 2949 bytes including the Sembom example.

Changed OpenAPI, the core storage port, and the collector error contract. There are no changes to DB structure, migrations, SDK, dependencies, CI runner, or hygiene policy. The screen supports lookup only, so the change-form integration remains. Actual OIDC accounts, remote D1, and production deployment were not verified because the environment is not connected, and nothing was pushed, deployed, or activated in Sembom.

Status: locally verified the core, D1 storage, collector, browser SDK, admin lookup/settings-change API, OIDC verifier adapter, v0.1 contracts, and sample UI. The browser SDK was verified by commit `cb3f2ff`, subsequent example/size checks, collector integration tests, and real-browser measurement of the synthetic screen. The Sembom example remains only in the repository and has not been installed or activated in a real service. Actual identity providers, production sign-in, remote DB migrations, and production deployment are not yet present.

2026-10-08 admin lookup slice verification: implemented admin GET lookup in `apps/collector/src/admin.ts` and the `createWorker(verifyBearer)` verifier port in `index.ts`, and added 1 native Worker factory smoke test that uses a mocked trusted verifier and the actual D1 grant boundary under Miniflare. `node --test` passed `apps/collector/test/admin.test.ts` 9/9. Parent verification passed root `npm run check` (typecheck + 86 tests + SDK+Sembom gzip 2949-byte budget) and 27 `tools/contracts` lint/check tests. With 1 later admin test there are currently 87 total tests, but root full check 87 was not run again (root check 86 → later admin 9/9). There are no DB schema or SQL migration changes; OpenAPI changed only by adding the admin GET 405 response and updating descriptions (paths and body shapes remain unchanged). The verifier was mocked only in tests; actual signature verification, identity providers, and token issuance are unimplemented and unverified. No credentials or tokens were created. Backend commit `404875c`; the smoke addition was a separate commit.

## OIDC verifier adapter

2026-10-08 OIDC slice verification: implemented `packages/auth-oidc` and `createOidcWorker(options)` (code commit `7e85001`). It validates signature, issuer, API audience, expiration, issued-at time, required claims, algorithm and token type, JWKS key refresh, bounded failure retry, size, and body time limits. It verifies actual signatures with keys generated during execution and creates no production credentials.

Related tests passed 10/10, and root `npm run check` passed (typecheck + all 97/97 tests + size check). Also verified under Miniflare Worker that a valid token returned 200, an invalid audience or tampered token returned 401, and a revoked grant returned 403. SDK gzip remained 2667 bytes and SDK+Sembom gzip 2949 bytes. Added `jose ^6` to the server adapter, and the new workspace is checked with the existing root commands. There are no changes to OpenAPI, DB, migrations, browser UI, or the root runner.

Actual identity providers, remote JWKS, browser sign-in/PKCE, token issuance/refresh, and production deployment were not run because settings and a connected environment are unavailable. The public-key cache lifetime is 10 minutes and the key-refresh re-lookup interval is 30 seconds. Per-token revocation/logout propagation is not implemented. Production external-key lookup and concurrent load are unverified; the result covers local transport and the Worker cryptography runtime. See the [OIDC adapter](../backend/oidc.md) for the detailed policy.

## Scheduled cleanup of expired data — 2026-10-08

Implemented locally the Worker `scheduled` handler, D1 iteration cursor, and migration 0002. Each run processes up to 5 projects and 500 rows per each of 6 tables, includes stopped projects, and continues after an individual failure. A CAS rejects a stale cursor update from an overlapping run.

Root `npm run check` passed (typecheck + 102/102 tests + browser size check). The 5 added tests cover project iteration/recreation/end wrap/deleted target/stopped project, failure isolation/DB failure/cursor conflict, the actual workerd scheduled handler, and D1 deletion. Of 501 expired receipts, only 500 were deleted on the first run and the 1 not yet expired remained. Also verified the 90-day aggregate boundary including project-local today and preservation of ingest revision. Applied 0002 to a DB with existing 0001 data and verified preservation of projects and receipts.

The first scheduled-failure test failed because it expected Miniflare's call to reject. The actual host returns `outcome: exception` in the scheduled result, so the test was changed to inspect that result and passed in the isolated 3/3 scheduled checks and the root 102/102 above.

`tools/contracts` checks passed 27/27 and `git diff --check` passed. SDK gzip remained 2667 bytes and SDK+Sembom gzip 2949 bytes. Added the production cursor table to DBML and updated migration-loader/DB-contract expectations in 0002 and the tests. Did not change OpenAPI, the browser SDK, root package scripts, dependencies, or CI.

Remote Cron Trigger registration, deployment, and D1 application were not run because there is no approved deployment scope or resource configuration. Long-term backlog, throughput, and cost remain unmeasured in production. Admin UI checks were not repeated because they are outside this server-cleanup change. Conditions and rollback are documented in [Automatic cleanup](../backend/retention-cleanup.md).

## Local project registration and permission-management CLI — 2026-10-08

Implemented init/register/grant/revoke in `tools/provision` (code commit `d8019cf`). It uses Node 24 and persistent local D1 under Miniflare and previews by default. Only `--apply` changes state, and `--expect-plan` checks that the reviewed input/DB state still matches. It checks timezone and published-schema immutability, new-version increment, last-owner protection, and atomic rollback on a CAS conflict. The CLI is for a trusted filesystem operator and does not perform sign-in.

Typecheck, related CLI tests 6/6, and all 108/108 in root `npm run check` passed. Verified exclusion from the lookup list after permission revocation, a conflict between two owner-removal plans, rejection of a stale snapshot when the plan makes no changes, no-op re-registration, the actual CLI process's help/failure exit codes, and a persistent DB rerun. `tools/contracts` checks passed 27/27. SDK gzip remained 2667 bytes and SDK+Sembom gzip 2949 bytes, within the 3072-byte budget. `git diff --check` passed. Added installed `@types/node` 24.19.1 as development dependency `^24` and included the CLI in root typecheck and the test runner. Did not change runtime code or the installed version after checking; only widened the dependency declaration range within the same major.

There are no changes to OpenAPI, DBML, SQL migrations, the browser SDK, or CI. Documented the boundary between the local operator and lookup grant in `docs/backend/02-authorization.md` and recorded usage and recovery in `docs/backend/provisioning.md`. Actual identity-provider users, production permissions, remote DB, deployment, and load were not run because there are no environment settings or approved scope. UI checks were not repeated because they are outside this CLI scope. Nothing was pushed, deployed, or migrated remotely.

## Collector runtime and deployment configuration — 2026-10-08

Runtime code commit `3eda6ef`: `apps/collector/src/runtime.ts` validates D1/OIDC environment configuration and reuses a verifier cache for the same configuration. The shared factory and closed default export remain. `collector:dev` opens the same persistent local D1 as the registration CLI and checks initialization state. It binds to 127.0.0.1, schedules cleanup every 60 seconds, prevents overlapping runs, and releases in-progress cleanup, timers, and the runtime on shutdown. Restart is required after code/config changes.

`npm run check` passed: Wrangler-generated types, shared/host typecheck, all 111/111 tests, and the browser size check. The 3/3 added config/runtime checks cover configuration errors and no-network validation; actual test signing through environment bindings, 401/200 and 403 after grant revocation, and scheduled invocation; and reuse of a DB created by the registration CLI, rejection of an uninitialized DB, and listener cleanup after shutdown. The 60-second timer itself was not observed long term; cleanup invocation was checked directly.

`collector:config` validates the format of account/DB IDs and OIDC settings and creates new files only. It makes no remote request, resource creation, or overwrite. Typecheck and 3/3 related tests for the target-preparation tool passed afterward. There are currently 114 tests; all 114 were not rerun (full 111 + 3 added). `npm run collector:dev -- --help` passed. `npm run collector:dry-run` checked the default Worker bundle without upload: 97.63KiB, gzip 24.61KiB. Because production target values are unavailable, it did not create a bundle from production settings or verify the existence/ownership of a remote ID.

Added development dependency `wrangler ^4` (installed 4.148.0). The verified compatibility date 2026-08-06 is unchanged. Root typecheck generates platform types under `.tmp` and checks with a separate host tsconfig. SDK gzip remained 2667 bytes and SDK+Sembom gzip 2949 bytes. There are no changes to OpenAPI, DBML, SQL migrations, the browser SDK, or CI. Added ignore rules for `.wrangler` and `.dev.vars`. Documented runtime configuration and log policy in `wrangler.jsonc` and `docs/backend/runtime.md`, and production configuration in `docs/ops/config-and-env.md`. Enabled structured app logs only and disabled invocation logs containing request URLs and automatic traces under the privacy contract. Storage and export of platform logs require additional review in a remote environment.

Remote identity-provider connection, D1 migration, grant registration, Cron Trigger, deployment, and load were not run because there are no actual resource/settings or approved scope. UI checks are outside the changed scope. Nothing was pushed, deployed, or changed remotely. Contract checks 27/27, `git diff --check`, `ssealed update . --yes`, and `ssealed doctor . --strict` passed.

## Verification names
Scaffold `ssealed update . --yes` and `ssealed doctor . --strict` passed.
Kept the existing key ordering in the manifest, leaving only a checksum update.

Keep names connected to the existing checklist: `format`, `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`, `docs`, `check`.

## Root package
The repository root uses npm workspaces and the Node 24 runtime runner.

```sh
npm ci --ignore-scripts
npm ci --prefix prototypes/admin --ignore-scripts
npm run typecheck
npm test
npm run check
```

- `typecheck`: uses `tsc --noEmit` to check core, storage adapter, collector, browser SDK source, and the `examples/sembom` example source.
- `test`: uses `node --test` to run tests in `packages/core`, `packages/storage-d1`, `packages/browser`, and `apps/collector`.
- `test:core`: runs core tests only. Registry, batch, time, and hash validation are passing.
- `test:browser`: runs browser SDK tests only.
- `build:browser`: builds `packages/browser/dist/index.js` with esbuild and emits type declarations with `tsc -p tsconfig.build.json`.
- `check:browser-size`: checks example-schema projection consistency and the browser bundle size budget.
- `check`: runs `typecheck`, `test`, and `check:browser-size` in order.

Storage-adapter tests apply `db/migrations/0001_initial.sql` to Miniflare D1 and verify atomic commit, CAS guards, duplicates, quota, and expiration cleanup. Collector tests call the esbuild-bundled Worker under Miniflare and verify HTTP boundaries (origin, body limit, CORS, error responses, admin 401). Tests use Node 24 and Miniflare 4's workerd binary; `compatibilityDate` is `2026-08-06`. A newer date (for example, 2026-10-08) has not yet been verified.

2026-10-08 verification: root `npm run check` (typecheck + 78 tests at the time of execution) and the separate `check:browser-size` passed. Later connected the size check to the default `check`. Tests comprise the existing 58 plus 19 browser SDK and 1 SDK→Worker→D1 integration test, for 78. `npm run build:browser` and `npm run check:browser-size` passed; sizes were SDK 5747 bytes/gzip 2667 bytes and SDK+Sembom adapter/schema 6628 bytes/gzip 2949 bytes, within the 3072-byte budget. The development-only contract checks `tools/contracts` lint/check passed 27, as did OpenAPI Redocly lint and typecheck. `npm ci` was not run again because it was already installed, and `git diff --check` passed.

Root tests also include `tools/provision` and `tools/runtime`. Integration tests use the admin server, so install `prototypes/admin` dependencies separately.

## Contract checks
The development-only contract-check package is `tools/contracts/` and is separate from production code.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

`lint` is Redocly's OpenAPI 3.1 syntax and reference check. `check` checks JSON examples, invalid wire input, example registry/cardinality/date/aggregate consistency, DBML parsing, and documentation links. It does not execute the collector state machine, DB transactions, production authentication, or remote migrations.
