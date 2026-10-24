# Validation History 07

This is a historical record that preserves the section order of the original. Commands and code paths are relative to the repository root.

## Concurrent load across retained data and 3 collector Workers — 2026-10-11

The separate opt-in `npm.cmd run bench:cluster` uses 3 collector Workers in one workerd and a new shared D1. For 6 projects, it registers retained and expired receipts, workflow state, 90-day aggregates, and a separate mixed-source funnel. The initial 6 data tables total 148,260 rows, and direct SQL preparation is excluded from HTTP measurement. On each of 60 waves, it sends the same workflow batch and the browser/server funnel batches to all three Workers concurrently and mixes in authenticated reads. The run uses 120 seconds of real time, 7.5 HTTP requests per second, a concurrency limit of 16, a 15-second request budget, and a 180-second CLI budget, and it calls actual scheduled cleanup every 5 seconds while switching Workers.

- `npm.cmd run bench:cluster`: exit code 0, verified=true. The load window was 120,013.031ms, with 900 HTTP requests, 24 cleanup runs, accepted 3,600, duplicates 7,200, a maximum observed simultaneous HTTP count of 15, and 12 cleanup calls that overlapped HTTP. Every HTTP request returned 200 and there were no client retries. It compared all valid event/workflow aggregate rows with the initial values plus accepted changes and checked the number of retained rows, expired removals, and cleanup revision 24. The final funnel API/DB stage values were 600 for each of the three Workers. The initial failure occurred because the experimental requestsPerMinute=1200 exceeded the registered limit of 600; it passed after being corrected to 600. After the first failure, the stage names were made more specific.
- p95 by type (ms): workflow 360.163, browser-funnel 366.852, server-funnel 366.711, summary 85.994, funnel 92.917, cleanup 347.736. Publication latency p95 was 15.006ms. The maxima in the same type order were 584.140, 581.403, 580.375, 315.694, 315.613, and 546.801ms.
- Final row counts: receipts 63,600, workflow attempts 60,600, event daily 9,728, workflow daily 1,620, funnel runs 600, funnel daily 8. The observation and DB remain in `.tmp/cluster-bench/run-jZczec/report.json` and the state of the same run.
- `node .tmp/cluster-extra-verification.mjs`: exit code 0. It ran the same SQL as the two final checks added after the experiment against the saved synthetic DB in readOnly mode, confirming that all four timestamps existed for 600 runs and that each source had 600 of each of the four events (1,200 each for browser/server). A separate workerd `metadata.sqlite` was excluded. After adding the new final checks, the 120-second load was not repeated.
- `node node_modules/typescript/bin/tsc --noEmit`: final code exit code 0.
- `npm.cmd run bench:cluster -- --help`: exit code 0. `--remote` is rejected with fixed guidance and exit code 1. This 2-minute experiment was not added to the existing default test/check/CI.
- `git diff --check`: exit code 0.

The run used Node 24.18.0, Miniflare 4.20260730.0, Windows x64, and a Ryzen 5 7430U (12 logical CPUs), with real-time Worker clocks and an in-memory temporary JWKS/signing key. It did not access production authentication or a remote/existing DB, and the runtime is closed in finally. Because this is a separate collector-Worker experiment on one host/workerd, it is not evidence about multiple processes/regions, long-duration operation, maximum throughput, or production latency/cost. We updated the operations guide, collector boundaries, roadmap, and validation record. There are no API, DB, SDK, dependency, CI-runner, or hygiene-policy changes. Admin/SDK builds, general source lint, and production-provider/deployment checks were either outside the scope or had no configuration and were skipped. There was no actual service integration, push, or deployment.

## Separating local collector Workers on the same D1 — 2026-10-11

`collectorHarness` retains one default Worker, and each optional 2–4 profile connects a loopback router and a separately named collector Worker. All collector Workers bind the same new D1 ID, and a verification-only response header distinguishes the actual execution instance. Keys, JWKS, and signing tokens exist only in memory, and it accepts neither an existing DB path nor a remote URL. The compatible dates remain exactly as in the existing experiment target.

- `node --test --test-timeout=30000 tools/runtime/test/collector-cluster.test.ts
  tools/runtime/test/collector-bench.test.ts tools/runtime/test/retained-bench.test.ts`: 6/6, exit code 0. For the same batch sent concurrently to three Workers over HTTP, it checked the accepted total 1 and duplicates 2, signed authenticated reads per instance, shared D1 row counts, router path rejection, and the existing fixture/load tools. The initial test event name differed from the registered definition and produced 422; it passed after being changed to the actual tool_view. Each test runtime is closed in finally.
- `node node_modules/typescript/bin/tsc --noEmit`: exit code 0.

This validates 3 separate collector Workers in one Miniflare/workerd; it is not validation of multiple processes/regions, long-duration operation, or production D1. Next are retained data in this environment, the planned actual load, and concurrent cleanup. There are no API, DB, SDK, dependency, CI, or hygiene-policy changes. Admin/SDK builds were outside the scope and skipped, and there is no general source-lint script. Production authentication, deployment, push, and service integration were not run.

## Previous-period comparison and CSV by funnel property — 2026-10-11

For the same dimension, project, version, and funnel definition, it additionally queries the previous cohort of the same length. It compares the union while retaining each value's data type, and a value not observed on one side remains a count of 0 with a null ratio. The CSV distinguishes classification rows actually observed across both periods from per-value comparison metrics, and it does not create daily rows for missing values. A breakdown comparison failure preserves the current breakdown, locks only the CSV, and provides a separate retry.

- `npm.cmd run test:admin`: 193/193, exit code 0. The 4 new cases check values present on both/one side, data types, 0/null, stage changes, identical-definition/period validation, and CSV date/time/type/comparison rows, as well as the absence of daily rows for missing values.
- `npm.cmd run typecheck:admin`, `npm.cmd run build:admin`: each had exit code 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, exit code 0.
- `node .tmp/funnel-breakdown-comparison-smoke.mjs`: with Chrome, Vite, real React, and synthetic responses, it checked no request before selection, one each for the current/previous requests, selecting a value seen only in the previous period, stage changes, CSV, breakdown-comparison failure/retry with preservation of the current result, CSV locking, AbortSignal on comparison release, discarding late responses, retained-range guidance, and context switching. It confirmed no 320px document overflow, keyboard scrolling inside the table, and 0 pageerrors, and opened the desktop/mobile screenshots. The initial harness's global comparison-title selector collided with the new per-property title and passed after being corrected to an exact selector. The harness stopped the temporary server and browser.
- `git diff --check`: exit code 0.

We updated the product specification, roadmap, and frontend design. The API, DB, SDK, dependencies, CI runner, and hygiene policy were unchanged. There is no general source-lint script, and the backend/Sites handoff and full-load checks were outside the scope and not repeated. Production authentication/D1, remote load, push, deployment, and service pilots were not run. When the full and breakdown requests happen at different times, their totals can differ; the screen explains this.

## Admin screens and CSV by funnel property — 2026-10-11

The breakdown API is queried only after selecting a registered dimension, and the screen shows a per-value summary plus the stages and daily details for the selected value. It validates responses for closed shape, data types, registered values, definition, dates, and stages/totals, and applies cancellation and generation guards. On a breakdown failure it preserves the full result, locks only the CSV, and recovers through retry or release. CSV breakdown rows explicitly identify the current period category and retain group_by, property_type, and property_value.

- `npm.cmd run test:admin`: 189/189, exit code 0. The 6 breakdown cases check the new contract, data types, cancellation, errors, empty results, and CSV, plus regressions in the existing full-funnel/period comparison.
- `npm.cmd run typecheck:admin`, `npm.cmd run build:admin`: each had exit code 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, exit code 0.
- `node .tmp/funnel-breakdown-smoke.mjs`: with Chrome, Vite, real React, and a synthetic transport, it checked no extra request before selection, per-value stages, CSV, failure/retry, breakdown release, discarding late responses, context switching, no 320px document overflow, and 0 pageerrors. The harness stops the server and browser.
- `git diff --check`: exit code 0.

We updated the product specification, frontend design, and roadmap. There are no API, DB, SDK, dependency, CI, or hygiene-policy changes. General source lint was skipped because no command exists, and backend/Sites handoff checks were outside the changed scope and not repeated. The browser checks did not re-verify authentication/D1 integration, and the production provider, remote DB, push, deployment, and Sembom integration were not run. Previous-period comparison by property is the next slice.

## Read API by property for multi-stage funnels — 2026-10-11

We added the separate GET `/v1/projects/{projectId}/funnels/{funnelId}/breakdown` endpoint, the required groupBy, and `FunnelBreakdownResponse`/bucket to OpenAPI, and connected the core types, D1 projection, and admin route. It reads only existing counts by dimension_key and groups them by one registered starting dimension, and it checks the stage order of every combination before aggregation. The existing daily response, registration, write, and retention rules and the DB were unchanged.

- `node --test --test-timeout=30000 apps/collector/test/funnel-query.test.ts
  apps/collector/test/server-query.test.ts`: 21/21, exit code 0. Against actual local D1/HTTP, it checked breakdown/full totals, missing dates, 0/null, provisional status, source crossing, authentication/permission, another project/version, invalid parameters, corrupt stored dimensions, and regressions in the existing daily/server queries. Projection checks covered boolean false and integer 0, merging the original combination, reordered duplicates, a corrupt combination masked by a valid one, the row limit, and safe-integer overflow. The initial error injection was blocked by the DB JSON CHECK, so it was changed to a bad tuple in valid JSON; after adding a missing purpose for the new test definition it passed.
- `node node_modules/typescript/bin/tsc --noEmit`: exit code 0.
- `node node_modules/typescript/bin/tsc -p apps/collector/tsconfig.runtime.json`: exit code 0.
- `npm.cmd run check` in `tools/contracts`: 63/63, exit code 0. It checks the new examples, closed response, value types, bucket/day limits, required groupBy, and unsupported source, as well as the existing API/DB contracts.
- `npm.cmd run lint` in the same folder: OpenAPI valid, exit code 0.
- `git diff --check`: exit code 0.

We updated the contract source `api/openapi.yaml`, API examples, admin boundaries, product specification, and roadmap. The DB, migrations, SDK, admin UI, dependencies, CI runner, and hygiene policy were unchanged. UI connection is the next slice, so admin build/browser checks were not run, and full release/load checks were not repeated for this read-only scope. Production authentication, remote DB/deployment, Sembom activation, and push were not run.

## Previous-period comparison and CSV for multi-stage funnels — 2026-10-11

After the current report for the selected funnel is ready, it queries the existing API for the previous cohort with the same project, schema version, definition, and equal-length start-date range. During comparison or failure it preserves the current result and locks only the CSV. Comparison release, selection, context, and connection changes use cancellation and response guards. CSV keeps the current-period-only format and adds period, metric, current/previous values, and change/unit columns only when comparing.

- `npm.cmd run test:admin`: 183/183, exit code 0. The 4 new comparison cases check count/rate changes, 0/null, mismatches in project/version/definition/time zone/previous period, and CSV for both periods, timestamps, and comparison metrics.
- `npm.cmd run typecheck:admin`: exit code 0.
- `npm.cmd run build:admin`: exit code 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, exit code 0.
- Separate Chrome smoke: with real React components, a Vite server, and synthetic API responses, it checked no extra query before selection/comparison, a normal comparison, failure/retry, preservation of the current result, CSV locking and downloaded content, retained-range guidance/release, discarding late responses, context switching, no 320px document overflow, and 0 pageerrors. It checked desktop/mobile screenshots and stopped the server and browser. An initial path/React-load problem in the test page passed after the temporary harness was fixed.
- `git diff --check`: exit code 0.

We updated the product specification, frontend design, and roadmap. The API, DB, SDK, dependencies, CI runner, and hygiene policy were unchanged. The browser check did not repeat authentication/D1 integration, and the production provider and remote data query were not run. The full backend check and Sites handoff check were outside the changed scope and not repeated. There was no push, deployment, or Sembom integration.

## Converting Wrangler tail JSON into a local report — 2026-10-11

We added `--stdin --wrangler-tail` to `logs:summary` and kept the default NDJSON path. `WranglerTailInput` separates multiple-line and single-line JSON objects delimited by whitespace while respecting strings, escapes, and nesting. It sends the single app JSON string in `logs[].message` to the existing aggregator and does not output the wrapped object's request URL, headers, exceptions, timestamp, or script name. Unrelated console records are counted only as ignored records, without their contents. An app record sent as an object or multiple arguments is rejected. Output v2 is unchanged.

- We checked the installed Wrangler 4.148.0 `tail --help`, the output code in `src/tail/printing.ts`, and the Cloudflare real-time log documentation. We did not run `wrangler tail` remotely.
- `node --test --test-timeout=30000 tools/runtime/test/wrangler-tail-input.test.ts
  tools/runtime/test/summarize-observations.test.ts tools/runtime/test/observation-summary.test.ts
  tools/runtime/test/observation-diagnostics.test.ts`: 30/30, exit code 0. It checked actual Node CLI stdout/stderr, compatibility with the admin report parser, NDJSON regressions, CRLF and byte-split UTF-8/escapes, exclusion of raw content, duplicates/conflicts, malformed input, private fields, incomplete input, banners, empty observations, limits on total bytes/objects/lines/depth/console records, timeouts, stream failures, and listener cleanup.
- `node node_modules/typescript/bin/tsc --noEmit`: exit code 0.
- `git diff --check`: exit code 0.

In the first check, 2 tests failed because they passed a string to the report parser. After correcting the tests to match the parser's actual object contract, all checks above passed. We updated usage, operations observation, the local-viewer guide, README, and roadmap. The API, DB, migrations, SDK, admin UI, production configuration, dependencies, CI runner, and hygiene policy were unchanged. UI build/browser revalidation and the full backend check were outside the changed scope and not repeated. Actual production input, log sessions, additional platform sampling, remote authentication, and deployment remain untested, and tail output neither corrects for missing records nor supports claiming total request counts or service health. Nothing was pushed or deployed.

## Admin local operations log report screen — 2026-10-11

We added `ObservationReportPanel`, `ObservationReportView`, and dedicated CSS, and load them lazily only from the API connection settings. File selection sends a v2 JSON report up to 8MiB to the actual Worker and displays observation counts, weighted request estimates, diagnostics, HTTP status/code, latency bands, and cleanup runs/processed counts in tables. HTTP responses page 25 rows at a time, and a new report returns to the first page. When cleanup details are absent, the processed count is shown as `—` instead of 0. The screen explains that this is a collector-wide log summary separate from project/period filters.

- `npm.cmd run typecheck:admin`: exit code 0.
- `npm.cmd run test:admin`: 179/179, exit code 0.
- `npm.cmd run build:admin`: exit code 0. The report panel is 4.05kB gzip JS and 0.54kB gzip CSS, and its separate Worker is 7.75kB uncompressed. It is not included in the initial screen graph.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, exit code 0. We added exclusion of the new panel from the initial/API static graph to the existing check.

A separate Chrome smoke used a synthetic summary produced by the actual CLI, a production-build preview, temporary signed OIDC, and a Miniflare collector/D1. It read the file in a Worker shaped like the actual deployment and checked normal data, extra identifier fields, a file over 8MiB, a new file, clearing, closing, disconnecting, and an old v2 report without diagnostics. It paged through all 75 HTTP responses 25 at a time and returned to the first page with a new report. It confirmed that the three processed values in a cleanup report containing only failure indicators were `—`. During the file read there were 0 extra `/v1` requests, 0 localStorage/sessionStorage entries, no 320px horizontal document overflow, and 0 pageerrors. Desktop/mobile screenshots were also checked. The owned server, browser, and temporary D1 were stopped/deleted.

We updated the product specification, operations observation, new usage guide, README, admin README, documentation index, and roadmap. The API, DB, migrations, SDK, dependencies, CI, and production configuration were unchanged. The full backend check, load experiment, and Sites handoff were outside the changed scope and not repeated, and actual production logs, remote monitoring, alerts, push, and deployment were not run. The recursive deletion of `.tmp/observation-view-check` left by a subagent was blocked by automatic approval review under policy, so that ignored validation file remains.

## Browser-side reading foundation for operations log reports — 2026-10-11

We separated the CLI aggregator's size, operation, code, and latency bucket lists into the I/O-free `observation-values.ts`, and the existing aggregator uses the same values. We added a v2 report parser, file Worker, and bounded `ReportReader` to the admin. This slice is the step before connecting the screen. It rejects raw NDJSON, extra/identifier fields, fake coverage/health, duplicate entries, values outside the safe-integer range, inconsistent response/latency/total sums, sample weights, cleanup sums, and diagnostic mismatches. An older v2 report without additive diagnostics leaves diagnostics null.

- `node --test src/api/observation-report.test.mjs` in the admin: 7/7, exit code 0.
- `node --test tools/runtime/test/observation-summary.test.ts tools/runtime/test/observation-diagnostics.test.ts tools/runtime/test/summarize-observations.test.ts` at the root: 20/20, exit code 0.
- `npm.cmd exec -- tsc --noEmit`, `npm.cmd run typecheck:admin`: each had exit code 0.

We compared actual CLI aggregation results with the parser and also checked reports with nested cleanup failure indicators, runs without details, and no HTTP data. The Worker port check verifies no creation before selection, the 8MiB limit, termination on new file/close/release, discarding late responses, the 10-second read limit, and fixed errors. The actual browser Worker and screen are a follow-up. The first focused test failed because Node strip-only mode does not support parameter properties; it was changed to explicit fields. The admin typecheck passed after adding a node type reference only to tests that reference the Node aggregator. There are no API, DB, SDK, dependency, CI, production-configuration, or remote changes.

## Actual admin browser login verification command — 2026-10-11

We added the optional `verify:admin-login`, `tools/browser-bench/admin-login.mjs`, and a stub fixture. It uses the actual Vite admin UI and Miniflare collector/D1, and the `.invalid` provider URL is intercepted in the browser, so no request goes to an external provider. Signing keys, code, and tokens exist only in memory, public configuration is injected explicitly, and the `.env` file and the caller's login/collector target values are not used. The collector's sample log is emitted only inside the stub and is not placed in the CLI report or even as a requestId.

- `npm.cmd run verify:admin-login -- --channel chrome`: exit code 0, Chrome 154.0.8037.98.
- `node tools/browser-bench/admin-login.mjs --help`: exit code 0.
- `node tools/browser-bench/admin-login.mjs --channel invalid`: fixed arguments error, exit code 1.

The test passed the full flow through the actual UI login button, S256 authorization redirect, ID token signature with nonce, one-time code exchange, callback address cleanup, a successful query with the current access token, and a storage read. It moved only the browser wall clock forward 271 seconds and measured only the number of concurrent getAccessToken calls to confirm that multiple calls wait for one rotation refresh. When the next refresh was made to fail, the screen required authentication and hid the raw provider error. After restoring the original clock, it rejected an invalid state without exchanging the code, and it also checked that a new login and refresh required re-authentication. There were 3 authorizations, 2 code exchanges, 2 refreshes (1 success and 1 failure), 27 admin GETs, and 0 pageerrors, with empty localStorage/sessionStorage and cookies at every stage. It confirmed that the admin history snapshot was unchanged and deleted the temporary DB. During script cleanup, a duplicate variable name caused a syntax error once; after the name was corrected, the browser check passed.

We updated the README, development guide, admin README, OIDC guide, roadmap, and new login-validation guide. The production code for the app, collector, and SDK and the API, DB contracts, migrations, dependencies, and CI were unchanged. It uses the existing Playwright development package, and browser execution was not added to the default checks. Because production code was unchanged, the full checks, app build, and load experiment were not repeated. Registration with an actual OIDC provider, CORS, production access token/resource/audience, and remote deployment were not verified, and nothing was pushed or deployed.

## Storage read verification in admin settings — 2026-10-11

We added `LiveHealth`, `HealthReader`, a closed health-response parser, and `ApiClient.getHealth`, and connected them to the API-mode settings screen. A query occurs only through a button, with a 5-second timeout, duplicate-click blocking, deletion of a prior success after failure, and cancellation/discarding of late responses on close, connection replacement, or unmount. The success timestamp is the manual-check time and is distinct from the metric update time. It consumes the existing `/v1/health` contract, with no API, DB, migration, Worker, SDK, dependency, environment-variable, CI, hygiene-policy, or package-script changes.

- `npm.cmd run typecheck:admin`: exit code 0.
- `npm.cmd run test:admin`: 172/172, exit code 0. This includes 5 new focused health checks.
- `npm.cmd run build:admin`: exit code 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, exit code 0.

A separate local Chrome smoke went through temporary signed OIDC, the actual Vite proxy, a Miniflare collector, and an empty D1. With an admin connection lacking a grant, expanding it made 0 requests; the button succeeded; a response with an invalid scope showed an error; temporarily renaming the table returned storage 503 (restored at the end); a delayed request hit the 5-second timeout and was retried; and close/disconnect/reconnect cleared the result. There were 5 explicit health requests total, the project table was unchanged, there was no 320px horizontal document overflow, and there were 0 pageerrors; desktop/mobile screenshots were checked. The first smoke failed because the last-step button selector differed from the actual `Disconnect` label; the second run with the corrected selector had exit code 0. Injecting the storage failure produced one fixed `storage_unavailable` log entry, which is not an observation of a production incident.

We updated the README, admin README, roadmap, and operations-observation document. Because the collector and storage adapter did not change, their full checks and the load experiment were not repeated. An actual OIDC provider, remote status check, Sites handoff, push, and deployment were not run.

## Connecting a storage-read probe to the installation access check — 2026-10-11

We changed `tools/runtime/install-access-check.ts` and its focused tests. After verifying the admin identity's issuer, it must receive the closed `{status:'ok',scope:'administrator_storage_read'}` response before proceeding to the project query. Report v2 contains `admin-identity`, `admin-storage-read`, and `project-list` in that order, and distinguishes skipped steps as identity-check-required or storage-check-required unknown. We updated the README, roadmap, installation guide, and access-check guide. There are no API, DB, migration, Worker, SDK, dependency, environment-variable, CI, hygiene-policy, or package-script changes.

- `node --test --test-timeout=30000 tools/runtime/test/install-access-check.test.ts`: 7/7, exit code 0.
- `npm.cmd exec -- tsc --noEmit`: exit code 0.
- `node tools/runtime/install-access-check.ts --help`: exit code 0, printing help for the three-stage check and stopping dependent queries.

Through the actual admin Worker proxy, temporary signed OIDC, and local Miniflare D1, it checked an empty project and an accessible project, the DB snapshot and prepared files remaining unchanged, no token/identity/raw output, and the existing input/body-limit/cancellation checks. The new tests check that invalid/extra health fields and 401/404/503 block the project query, and that when an actual DB table is temporarily renamed, identity passes while health becomes unknown and project becomes storage-check-required. The test table was restored in finally. The limits remain 5 seconds per request, 15 seconds for the whole CLI, 30 seconds for stdin, and 16KiB for the body.

During execution, local workerd emitted two Win32 `WSARecv #64` diagnostics to stderr. We did not determine the cause. The later actual health-failure check and CLI success check completed, and Node tests exited 0. We do not hide these diagnostics or record the run as warning-free.

We did not run a production provider, remote access, push, or deployment. Because the existing Worker/API/DB/UI/SDK code did not change, their full checks, build, and load experiment were skipped.

All 124 local links in the five changed Markdown files exist, and `git diff --check` passed. The link check verifies file existence; it does not validate every anchor or external URL.

## Authenticated admin storage-read probe — 2026-10-11

We added `GET /v1/health`, an optional `AdministratorAccess.checkReadiness` port, a read-port connection for the native Worker, and a single batch of two `SELECT 1 ... LIMIT 1` queries in `readiness.ts`. Successful JSON has the two fixed fields status and scope. We updated the new OpenAPI response/example and contract checks and the operations/product documentation. There are no DB, migration, SDK, environment-variable, dependency, CI, hygiene-policy, or package-script changes.

Execution and results:

- `node --test --test-timeout=30000 apps/collector/test/readiness.test.ts apps/collector/test/admin.test.ts apps/collector/test/runtime.test.ts apps/collector/test/request-observation.test.ts`: 28/28, exit code 0.
- `npm.cmd exec -- tsc --noEmit` and `npm.cmd exec -- tsc -p apps/collector/tsconfig.runtime.json`: each had exit code 0.
- `npm.cmd run check` in `tools/contracts`: 61 passed, exit code 0.
- `npm.cmd run lint` in the same folder: OpenAPI valid, exit code 0.

The 5 new focused tests check successful access without a grant, no raw rows or identity output, unchanged write/collection quota, blocking DB access before authentication and method/query validation, not consuming the body, the fixed 503 and Retry-After when the port is not connected or raises, a single read batch that reads one constant row per table, success with an empty table, and failure when a table is missing. The existing runtime tests added a temporary RS256-signed JWT and workerd/D1 checks for authenticated 200, invalid audience/no-token 401, and missing table 503. These are not checks of an actual production provider, DB, or repeated monitoring.

We checked the existing fetch handling and the admin proxy's service-binding structure against the Cloudflare [fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/) and [HTTP service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/) documentation and local source. We did not add bindings, configuration, call logs, or traces.

Because the admin UI and SDK code were unchanged, their full checks, build, and load experiment were skipped. We did not make remote calls, apply migrations, push, or deploy. Because this probe checks only reads from two control tables, it cannot be used as evidence for collection writes, all 16 tables, Cron behavior, or overall service availability.

All 171 local links in the 8 changed Markdown files exist, and `git diff --check` passed. The link check confirmed file existence only; it did not verify every anchor or external URL.
