# Verification History 03

This is a historical record that preserves the order of the original sections. Commands and code paths are relative to the repository root.

## Final Verification of Resource Lifetime and Race Improvements (2026-10-23)

The full test suite was run with `node --test --test-concurrency=2 --test-timeout=30000` and the existing test path in the package script, and 489/489 tests passed. The admin tests 276/276 and the final OIDC and authentication tests 18/18 also passed. When 12 authentication requests were run concurrently on the actual Worker, all succeeded, there were 2 JWKS lookups in total, no more than 2 ran concurrently, and 0 remained active after completion. Protection was added so that a failure from an older lookup that completed out of order could not overwrite the cooldown after a newer success. The admin build, 63 contract tests, and the final root TypeScript check also passed.

The basic full parallel run hit a 30-second timeout under local Wrangler and Miniflare load. With concurrency 2, the full suite passed, and the package script and CI settings were not changed. The admin browser permission draft and mode-exit tests also passed with pageErrors=0 and routeError=false.

The API list's `grantRevision`, the write's `expectedRevision`, the DB 0010 columns, and its three triggers must be deployed together. For a remote deployment, apply 0010 first, then deploy the Collector and the updated admin UI together. The JWKS limit is per verifier instance and is not a distributed global limit. No remote DB application, push, deployment, publication, dependency, or CI change was performed.

## Admin Fallback Response Lifetime (2026-10-23)

The 404 body discarded by the SPA fallback is cancelled immediately in the admin Worker's `finally` block. Normally returned asset and fallback bodies are owned by the caller, and an exception, rejection, or unresolved cleanup Promise from cancellation does not alter the fallback response or the original error. Sites Worker tests 11/11, covering success, synchronous exception, asynchronous failure, AbortError, and cleanup combinations, and the diff check passed. There are no API, DB, dependency, or CI changes.

## OIDC External Lookup and Waiting Lifetime Limits (2026-10-23)

Each verifier limits external JWKS lookups to 2 and waiters to 32. A wait belongs to its request's deadline and Promise, and cancellation removes it from the queue and listeners. The slot is returned in `finally` and reserved for the earliest waiter, preventing a duplicate return or a new call from intercepting it. Only refreshed public JSON is reused while waiting, and a Response and stream are created for each request. Start order is compared so that an older lookup that completes out of order cannot overwrite the latest public-data cache. The limit is per instance and does not claim a distributed global limit. OIDC and actual Worker tests 18/18 passed, and OIDC 17/17 and the root TypeScript check passed after the ordering protection. There are no API, DB, dependency, or CI changes.

## Admin Grant Revision CAS (2026-10-23)

0010 preserves existing grant rows and adds `projects.grant_revision` and three triggers. Grant creation, deletion, and role changes through direct SQL, operations tools, or the API increment the revision. The list returns `grantRevision`, and the admin UI fixes `expectedRevision` at review time and passes it on PUT and DELETE. A stale or missing revision cannot change state and terminates with `grant_conflict`. If the state is already the same, the no-write recheck is retained. The operations tool plan also compares the revision. Required function arguments are preserved, and OpenAPI, DBML, and migration guidance were updated. After applying 0010, the Collector and admin UI must be updated together so the existing admin can edit grants.

Grant focused tests 31/31, migration and client reinforcement 13/13, the corrected server collection and client tests 17/17, 63 contract tests, and the root and admin TypeScript checks passed. The real browser grant-save response loss, draft, and exit tests succeeded with pageErrors=0 and routeError=false. The first full parallel run found a fixture mismatch for the new column and a 30-second timeout under load; the expected value was corrected, and the final full run used lower concurrency. There was no remote DB application, push, deployment, dependency, or CI change.

## Removing Configuration Races from Per-Minute Limit Decisions (2026-10-23)

The required arguments to `admit` are preserved, but approval and `minute_limit` aggregation are decided from `projects.requests_per_minute` read in the same SQL statement. If the limit is lowered or raised after configuration is read, they are not approved or rejected using an old caller value. A TypeScript constant name that remained in the rejection-aggregation SQL was also corrected to numeric interpolation. Real D1 and Worker focused tests 28/28, the root TypeScript check, and the diff check passed. There are no changes to APIs, the DB structure, dependencies, or CI.

## Final Package Integration Verification for the Refactor (2026-10-22)

Two internal type declarations generated by the SDK policy file split were added to the exact tarball file list. `verify:sdk-packages` passed after rebuilding both SDKs, removing stale output, packing offline, installing outside the workspace, compiling NodeNext declarations, and running the three entry points. There were 0 network or credential calls, and the public API shape and runtime dependencies are preserved. The full root type check also passed. The SDK 98/98, admin 275/275, and monitor and access 19/19 test groups in this follow-up scope passed. The full `npm test` and remote production checks were out of scope and were not run. There was no push, deployment, or publication.

## Separating Monitor File Lifetimes (2026-10-22)

State-file handling was split into separate functions for lock ownership, bounded file reads, cancellable observation, and temporary-file publication. Another writer's lock or temporary file is not deleted, and the close and unlink order and the rule that a save succeeds after rename are preserved. File, monitor, and access tests 19/19, the root TypeScript check, and the diff check passed. The real access-failure test produced the existing Windows workerd WSARecv #64 diagnostic, but the test exited normally. There are no API, DB, dependency, or CI changes.

## Separating Admin State Ownership and Query Lifetimes (2026-10-22)

SettingsEditor exposes private state and a read-only getter and subscription view. It copies and freezes API snapshots and passes a separate copy to the saved callback, so the caller's original is not frozen and external changes cannot alter the draft, permission, or error state. Project-list and page generation and the AbortController were consolidated in `useProjectPages`, while the main query, period comparison, and time series moved into separate hooks. Verification order and the rule against returning before hooks are preserved. Admin tests 275/275, the type check and build, and browser settings navigation (including creation followed by a switch and analytics refresh) and analytics permission tests passed. In the initial full run, an existing 100ms native request test failed under parallel load; after the credential deadline was verified with a virtual clock, the full suite passed. Browser pageErrors and routeError were 0 and false. A Windows WSASend #10053 diagnostic appeared during Worker shutdown, but the test succeeded. There are no API, DB, dependency, or CI changes and no remote reflection.

## Separating SDK Transport Stages and Policy (2026-10-22)

The server SDK's batch copy and validation, single-request handling, and HTTP termination classification were separated, and ownership of transport progress state was centralized in `send`. The actual request count, error classification, and cancellation order for authentication, body, and retries are preserved. The browser's Retry-After calculation is a pure function, and the queue, request, and retry limits are managed with lightweight constants. SDK tests 98/98, the server build, and the root TypeScript check passed. Browser gzip checks measured Sembom at 3056 bytes, funnel at 3029 bytes, and generated funnel at 3054 bytes, all at or below 3072 bytes. The bundle test was changed to use source paths so internal file splitting is allowed. There are no API, DB, dependency, or CI changes.

## Separating D1 Snapshots from SQL and Response Computation (2026-10-22)

The optional publisher and funnel results in the ingestion snapshot are resolved by name inside the adapter. `commitIngest` coordinates only the existing permission and configuration check, the pure plan, atomic SQL execution, and conflict retry. Admin query SQL and response computation were also separated. Query order, the grant predicate, the single snapshot, and the write guard are preserved, and SQL row limits are calculated by domain policy. D1 and admin focused tests 59/59 and the root type check passed. There are no changes to the DB schema, API format, dependencies, or CI.

## Core Transition Computation and Policy Ownership (2026-10-22)

Workflow transitions were separated into pure computation that copies the input state. Receipt and step duplicate handling and the daily-limit order are preserved, and schema validation was split into event, workflow, and dimension comparisons. Definition projections are exposed as read-only borrowed views, while funnel-result properties are copied. Time, retention, schema, and query policy constants are shared in Core and are also applied on admin paths. Core and real D1 focused tests 70/70 and the root type check passed. There are no changes to response formats, the DB, dependencies, or CI.

## Separating Admin Routes and Collection Error Handling (2026-10-22)

`administrator` branches routes only after authentication and in the existing order, with read and write handlers and body parsing separated. Collector error headers are calculated by copying the input Headers, and rejection aggregation is handled by a separate function. Paths that must not read a body before the permission check and the existing body-first validation in the settings PATCH are preserved. Focused tests 61/61, the root type check, and the diff check passed. There are no changes to response formats, the DB, dependencies, or CI, and no remote reflection.

## Monitor State File Port and Cancellation (2026-10-22)

The last optional argument to `withMonitorFile` accepts narrow `files`, `uuid`, and `signal` ports. Even if an observation callback ignores cancellation, the wait ends and the lock is released, and a late result is not saved. File creation, writing, and sync clean up the owned file after completion, and a successful rename is treated as a completed save. The CLI passes the signal and optional file, UUID, and timeoutSignal ports. The in-memory file regression and existing real-file and access tests 19/19, the root type check, and the diff check passed. Write, sync, and rename failures, cancellation at each stage, sizes around 4096 bytes, and shared locking were checked. There are no DB, API, dependency, or CI changes.

The final admin and server collection tests 21/21 and the Collector runtime type check also passed. The focused test total for this change is 178/178. The real proxy failure test produced the existing Windows workerd WSARecv #64 diagnostic, but the test exited normally. Full CI, remote production verification, push, and deployment were not run.

## SDK Retry Clock and Virtual Deadline (2026-10-22)

An optional `monotonicNow` was added to BrowserPlatform. The default host separates date and HTTP-date handling from retry elapsed time, and existing custom hosts remain compatible through `now`. The finite-input limit assembles up to 20 events at once, always within 16KiB, reducing repeated string and size checks. The optional `timer` on ServerPlatform is used for every timed wait, with the existing timer as the fallback. SDK tests 98/98, both SDK builds, the root type check, and the diff check passed. Source and minified tests checked 10 minutes immediately before, exactly at, and immediately after; clock regression and advance; 20 maximum-length events; and virtual credential, request, body, and wait deadlines. gzip sizes were Sembom 3048 bytes, funnel example 3021 bytes, and generated funnel 3041 bytes, all at or below 3072 bytes. There are no changes to required arguments, response formats, the DB, dependencies, or CI.

## OIDC Wait Limits and Optional Clock and Cancellation (2026-10-22)

JWKS transport races against the deadline and does not wait for cleanup of an error, timeout, or cancellation body. Optional `now`, `monotonicNow`, and `timeoutSignal` control JWT times, failure cooldown, and the deadline. A per-call signal does not cancel the shared key lookup and ends only its own wait. Collector admin and publisher authentication pass `request.signal`. Required arguments, return types, and the authentication-failure `null` contract are preserved. OIDC and actual Worker authentication tests 16/16 and the root type check passed. The default 5-second allowance, expiry boundaries, delayed key lookup, unresolved cleanup, transport, and shared-lookup cancellation were checked. There are no changes to API response formats, the DB, dependencies, or CI. The internal jose cache clock keeps the existing implementation.

## Collection Body Cancellation and Request ID Injection (2026-10-22)

`readBody` handles the request or optional caller signal and a default 10-second read deadline. It does not wait for reader cleanup after an oversized body or cancellation, so an unresolved cancel Promise cannot block the error return. Existing required arguments and return types are preserved, and an optional `uuid` was added to CollectorOptions. Body, request ID, and actual Worker and D1 collection tests 24/24 passed. Sizes around 16KiB, stalled cleanup, cancellation during a read, and the read deadline were checked. There are no changes to API response formats, the DB, dependencies, or CI.

## SDK Tarballs and External Consumer Projects (2026-10-21)

`npm pack --dry-run --json --ignore-scripts` showed that the browser tarball included `dist/src/index.d.ts` (1,999 bytes), which the current build does not generate. Neither SDK build cleaned its output directory, so old artifacts could remain. After confirming the SDK's actual path was inside the checkout, shared output cleanup was added to delete only that `dist`.

The optional `npm run verify:sdk-packages` command places a stale-file regression probe, builds both SDKs, and packs them offline. It checks the exact file list and installs the tarballs into a new npm project outside the workspace with offline, `ignore-scripts`, and `no-save`. There it compiles the three ESM entry points and declarations with TypeScript NodeNext and runs inactive browser and funnel creation and disposal plus server event generation. It confirmed 0 network or token callback calls and that the actual installation was not a workspace symlink.

- Final `verify:sdk-packages`: passed. browser 7 files/6,222 bytes, server 3 files/4,995 bytes. SHA-256 values, file lists, types, and execution results are in `.tmp/sdk-packages/run-IIxWCx/report.json` and the tarballs.
- The initial isolated installation failed with EALLOWSCRIPTS because the parent `npm run` re-passed its allow-scripts setting. After checking the installed npm policy code, only the re-passed value was cleared in the child environment. The user's `.npmrc` policy and `ignore-scripts` are preserved. The intentionally wrong test project ID was also fixed before the final pass.
- `npm run check:browser-size`: passed. Sembom-inclusive gzip 3,067 bytes, funnel example 3,046 bytes, and generated-funnel code 3,068 bytes, all at or below 3,072 bytes and equal to the existing values.
- CLI `--help`, document-relative links, and `git diff --check` passed. The external consumer project created during the run was cleaned up, and only tarballs and reports remain in Git-excluded paths.

The SDK execution source, public APIs, DB, dependencies, and runner were not changed. Unchanged functional tests and browser onboarding were not rerun. Version 0.0.0 and `private true` are retained, and there was no registry login, publication, or remote change. Licensing, the public scope, and actual service installation remain undecided or unexecuted.

## Public Provider Check Wait Limits (2026-10-21)

The public OIDC discovery and JWKS checks also had a problem where a transport that ignored cancellation and an unresolved `body.cancel` could hold the wait open. The new regression test was cancelled at the 1-second limit before the fix. The existing request-lifecycle function now races header and body waits against cancellation, and failure and OPTIONS responses and reader cleanup are not awaited for their results. A late response is cleaned up and not adopted as a test result.

`node --test tools/runtime/test/install-check.test.ts` 5/5, the root type check, and `git diff --check` passed. After the initial fix, the regression test's "all reject" expectation did not match the normal rejection path that returns an immediate failure report, so it was changed to check for rejection within the limit or a failure report. Only public configuration and key fixtures were used; there were no actual provider or remote requests. There are no API, DB, SDK, dependency, or runner changes, and unchanged admin and SDK builds and the full suite were skipped.

## Current SDK Onboarding and Local Recovery Verification (2026-10-21)

- `npm run build:browser` and `npm run verify:admin-onboarding -- --channel chromium --lost-responses` passed. Chromium 156.0.8078.4 verified isolated signed login, empty-project creation, first schema publication, execution of the generated SDK, the first event 1, and the admin table display. After the create and publish success responses were each cut once, explicit recovery, draft replacement, and the SDK connection step also passed. There were 31 API reads, 5 writes, and 1 browser batch, with 0 route and page errors. No actual service or provider request was made.
- `npm run verify:restore` passed. The 0001 through 0009 migrations and 16 tables of a new synthetic DB were restored through actual local Wrangler SQL export and import. Schema and row fingerprints matched, `quick_check` returned `ok`, foreign-key violations were 0, and 5 protected writes were rejected. After restore, browser retransmission produced accepted 0/duplicates 2 and server retransmission produced accepted 0/duplicates 1. Publisher revocation, reassignment in the same millisecond, stale-revocation rejection, and no-op audit preservation also passed. The backup was 28,398 bytes, and the run took about 18.3 seconds. The report is `.tmp/restore-drill/run-tlQofv/report.json`.

The browser, Vite, and Miniflare instances created by each run were stopped. Synthetic reports and backups were left in Git-excluded paths. No remote or existing DB or production account was used, and the work was not extended to actual RTO/RPO, a service pilot, or mobile verification. This record does not change execution code, APIs, the DB, dependencies, or the runner.

## Authentication Access Repeated Check Command (2026-10-21)

`monitor:access` was added. It reuses the three GET checks from the existing access test and decides consecutive failure and recovery from the specified failure and recovery counts and maximum observation interval. The fingerprint and policy of the installed public configuration are bound to the state, and a different target or policy, a clock regression, or corrupted state is rejected before the token is read. The state contains only fixed metadata and is replaced with an exclusive lock and sync/rename. Cancellation ends token input and check waits and cleans up the lock. It outputs only notification intent; there is no actual send or periodic registration.

- `node --test tools/runtime/test/access-monitor.test.ts tools/runtime/test/install-access-check.test.ts`: 14/14 passed. Failure and recovery thresholds, interval boundaries, policy and target mismatches, corrupted and oversized files, nested execution, cancellation during token input, and previous-file preservation were checked.
- The test ran normal → 3 table-read failures → 2 recoveries, for 6 runs and 15 GETs in total, against a real admin Worker proxy, signed OIDC, and local D1. The events were healthy, failure_pending, incident_opened, incident_ongoing, recovery_pending, and incident_resolved, and there were only 2 notification intents, for opening and recovery. It also confirmed that the installed file remained unchanged and that output and state contained no token, issuer, subject, URL, or table name.
- The root type check, CLI `--help`, document-relative links, and `git diff --check` passed.

There was the existing Windows WSARecv #64 warning from workerd, but the focused tests exited with code 0. Actual OIDC, remote DB, scheduler, and notification recipients are not connected. State replacement and stdout delivery are separate, so delivery of a notification is not guaranteed. Unchanged admin and SDK builds and the full suite were skipped. There are no changes to APIs, the DB, dependencies, the runner, or repository hygiene, and no push, deployment, or publication.

## Installation Access Check Wait Limits (2026-10-21)

The path where a transport that ignored cancellation or an unresolved response cleanup blocked `install:access-check` was reproduced. The new regression test was cancelled at the 2-second limit before the fix. The existing request-lifecycle function is reused to race header and body waits against cancellation, and cleanup is not awaited. A late response has its body cleaned up and no subsequent read is started. The 401 and 403 decision and body limit are preserved.

Access tests 8/8, including the real admin proxy, signed OIDC, and local D1, the root type check, and `git diff --check` passed. The existing Windows workerd WSARecv #64 warning appeared once, and the test exit code was 0. Remote providers, D1, and deployment were not run. There are no changes to APIs, the DB, the SDK, dependencies, the runner, or repository hygiene, and unchanged admin UI and full collector builds were skipped.

## Design Status and Remaining Work (2026-10-21)

The current source, package scripts, and OIDC and operations documents were compared, and ARCHITECTURE's note that the admin was unimplemented and the risk register's undecided notes on retry, receipt TTL, permissions, schema, server publication, and funnel were corrected. CONTRIBUTING now describes the current code-change, validation, and commit procedure, and the start of the roadmap separates actual production connection, a pilot, abuse-prevention decisions, and public readiness from follow-up features.

The existence of document-relative links and `git diff --check` were confirmed. Execution code was not changed, so tests and builds were skipped. Licensing, operations policy, real providers, remote DB, push, deployment, and publication status were not changed. There are no changes to APIs, the DB, dependencies, the runner, or repository hygiene.

## Object Checks for Browser SDK Definition Maps (2026-10-13)

Even when an event property definition was `[]`, a number, a boolean, or an empty string, `Object.entries` returned an empty list and the event was accepted as having no properties. An empty array or scalar workflow map was also interpreted as a normal empty workflow list. Both maps are now checked to be objects, and an invalid configuration disables SDK creation. A normal empty-object definition remains supported. The batch JSON prefix for a verified version is built once at SDK creation to reduce regeneration per batch.

- Across the original and minified general and funnel checks, the 4 new `configuration.test.ts` tests all failed before the fix at `properties: []`. After the fix, 50 invalid map combinations produced no event wait, send, Beacon, timer, or visibility listener, while a normal empty object was sent.
- `npm run test:browser`: 53/53 passed. It checks the original and actual esbuild minified modules.
- `npm run build:browser`, `npx --no-install tsc --noEmit`, and `git diff --check` passed.
- `npm run check:browser-size`: passed the 3,072-byte gzip budget. Sembom integration was 3,067 bytes, funnel integration 3,046 bytes, and generated funnel integration 3,068 bytes. An initial fix exceeded the generated-funnel budget, and the final code was checked again.

There are no changes to APIs, the DB, public SDK types, dependencies, CI, or hygiene policy. The owned documentation updated by this work is this validation record. Unchanged admin, server SDK, and full collector checks were skipped, and actual Chromium, production OIDC, remote DB, and deployment environments were not checked. Configuration errors use the existing disabled-SDK behavior and do not provide a separate error notice in the UI. There was no push or deployment.

## Reusing Date Calculations for Classification Aggregates (2026-10-12)

Flow and funnel classification queries repeatedly calculated the time-zone boundary for the same date in each bucket. In the 31-day, 32-bucket regression test, both paths failed before the fix with 992 `Intl.DateTimeFormat` constructions. The per-date decision is now reused within only one response, reducing the count to 31, and empty bucket results are not calculated. The cache is not shared with other requests, so a new query after a time boundary recalculates the `provisional` value.

- `node --test --test-timeout=30000 packages/storage-d1/test/breakdown-dates.test.ts
  apps/collector/test/admin.test.ts apps/collector/test/funnel-query.test.ts`: 34/34 passed. The 6 new tests cover the maximum bucket and period, an empty result, and immediately before, at, and immediately after the date end plus 48 hours for New York spring and fall DST, plus a missing date with 0 count and a `null` ratio. The existing local Miniflare D1 API tests also passed.
- `npx --no-install tsc --noEmit` and `git diff --check` passed.
- On local Node 24.18.0, the pre-fix HEAD code and the fixed code were each warmed once and then run alternately 5 times. For 31 days and 32 buckets, the flow median across 992 rows was 277.71→11.13ms, and the funnel median across 3,968 rows was 362.66→39.40ms. All results were compared with `deepEqual` and matched. `.tmp/breakdown-bench.mjs` is a temporary local measurement and did not measure network, DB, Worker CPU, or production latency.

There are no changes to APIs, the DB, public SDK contracts, dependencies, CI or runner configuration, or hygiene policy. Unchanged admin UI, SDK, and full-repository checks were not repeated, and there is no general lint command. Production environments, real OIDC providers, and remote DB are unverified, and there was no push or deployment. The owned documentation updated by this work is this validation record only.

## Admin API Response Body Size Limit (2026-10-12)

When the basic native fetch path parsed an admin API response, it loaded the entire body into memory without a size limit. `readResponseJson` in `apps/admin/src/api/response-body.ts` now uses a 4MiB limit for success and a 16KiB limit for errors, with headroom for a 31-day, 32-bucket, 10-step funnel classification response. If `Content-Length` is not numeric or exceeds the limit, the response is rejected before reading, and stream accumulation is aborted when the byte count exceeds the limit. 401 and 403 are decided from status before the body is read, preserving notices and the permission lock. If a successful body cannot be read as JSON, the result is `contract`; if an error body fails to parse, the existing HTTP status message is used.

The reproduction was 2/2 failures in the new `response-body.test.mjs` before the fix. After the bounded-read fix, the focused lifecycle, access, and response-body run passed 31/31, followed by `check:admin` type checking, `test:admin` 274/274, `build:admin`, bundle separation 2/2, and Sites Worker 9/9. These 274, bundle 2, and sites9 runs occurred before the final streaming-buffer optimization. The first run was 273/274 because the native-fetch receiver test failed with a json-only mock; after that test was changed to a `Response.json` mock, the rerun log is `.tmp/admin-response-check.log`.

After the final streaming-buffer optimization (a single `Uint8Array` starting at 4KiB, exponential growth to the limit, and removal of per-chunk string arrays), the same change was checked again with narrower scope. Focused tests 34/34 (`.tmp/admin-response-focused.log`), admin type checking, and `build:admin` passed (`.tmp/admin-response-final-build.log`), and `npm run verify:admin-analysis-access` on Chromium 156.0.8078.4 with isolated D1 and local RS256 produced verified true, oversizedReads 1, recovery true, pageErrors 0, routeError false, apiReads 31, apiWrites 0, and authorizations 1 (`.tmp/admin-analysis-access-v5erlm/report.json`). After the buffer optimization, a cancelled socket produced one `workerd` WSASend 10053 diagnostic in this runner, but the test passed. The runner `node --check` and `git diff --check` also passed. This runner expands existing opt-in verification, and the UI, API, and DB contracts are unchanged.

The API, DB, public SDK, dependencies, and CI contracts were not changed. Remote environments were skipped, and unchanged backend and SDK checks were skipped. There is no source lint command. There was no push or deployment.

## Server SDK Response Deadline Checks (2026-10-12)

There was already a credential deadline check before transmission, but synchronous delays in response-header and receipt processing relied only on a timer. If the event loop was blocked, a valid receipt after the deadline was accepted as `delivered`. The original, minified, and same-batch automatic-retry 3 regressions all failed before the fix. The attempt and total deadlines are now checked with a monotonic clock immediately after the headers are received and after the receipt is parsed, and a late response is treated as an unknown result. Cancellation, retry counts, the total budget, and existing event identifiers are preserved.

- `npm run test:server`: 38/38 passed. The new deterministic tests check exact timeout and total-budget boundaries and overruns on both headers and body. A subsequent send with the same body receives a duplicate receipt. Real loopback HTTP with 100ms of synchronous header and stream processing and a 50ms timeout rejects a late success, and a fast retry sends the same bytes. This is not a small-sample performance measurement.
- `npx --no-install tsc --noEmit` and `npm run build:server` passed. The server bundle was 9110 bytes, gzip 3718 bytes, with runtimeDependencies 0. This is separate from the browser SDK size budget.
- `npm run verify:server-recovery`: verified=true, defaultSdkFetch=true, using 3 actual temporary Miniflare collectors and isolated D1. Before commit, a 503 was followed by accepted 2/attempts 2; after commit, socket loss was followed by duplicates 2/attempts 2; after 403, attempts 1 and no additional save. receipts 8, completedRuns 2, byteIdenticalRetries=true. No existing or remote DB was accessed. Result: `.tmp/server-recovery/run-tJXMUl`. The runner stopped the verification server.
- `git diff --check` passed. The SDK behavior guidance and this validation record were updated.

There are no changes to APIs, the DB, public SDK types, dependencies, CI or runner configuration, or hygiene policy. Unchanged admin and collector full checks and browser UI checks were not repeated, and there is no general lint command. Remote providers, production DB, and deployment environments are unverified. If the deadline passes after an actual server save, the result may be unknown and the existing event must be used for retry. There was no push, deployment, or publication.
