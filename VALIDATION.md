# Validation

## Administrator password-change navigation and 12-character minimum — 2026-10-25

Moved password changes out of the login screen into the session-protected
`/account/password` page. An explicitly configured administrator toolbar link
opens it in a new tab, preserving dashboard memory and unsaved edits. Expired
sessions sign in and return to this fixed account page. The optional installation
`login.passwordChangeUrl` must be HTTPS on the configured issuer's origin; external
providers can omit it. UI and Better Auth share a 12–128-character policy.

- Auth/Workers tests: 6/6 passed, including 11/129-character rejection, exactly
  12-character acceptance, current-password and session requirements, revoking
  other sessions, signing in with the changed credential, protected page access
  and absence of the change form from login.
- Installation and browser OIDC client tests: 19/19 passed, including optional
  public settings and rejection of foreign origins, credentials and URL queries.
- Root typecheck, production-configured admin build, both Worker deployment dry
  runs, 69/69 contract/documentation checks and `git diff --check` passed.
- Chromium 156.0.8078.4: the administrator login verification passed toolbar-link
  destination/new-tab assertions, PKCE, protected reads, rotating refresh,
  disconnect and callback cleanup, with 0 writes and 0 page errors. Its first
  attempt stopped before browser setup because the maintenance RPC import was
  absent from the fixture bundler's externals; adding `cloudflare:workers` fixed it.
- A separate isolated real Better Auth/Workers/D1 Chromium check passed return
  after login, confirmation mismatch, successful 12-character password change,
  form clearing and the administrator return link. Desktop and 390px screenshots
  were inspected; there was no horizontal overflow or page error. An initial
  route-interception test failed to follow a synthetic redirect, so runtime
  redirect assertions and explicit sign-in navigation were verified separately.
  Screenshots and the one-off harness are ignored in `.tmp/`.

The setup guide and administrator instructions were updated. No analytics API,
DB schema, dependency, CI runner or repository hygiene settings changed. The
unchanged full analytics suites were not repeated. No production password was
changed by verification; password mutation checks use disposable local accounts.

Deployed auth version `c28718cb-2605-4fbd-b879-7078cec7fc51` and administrator
version `470beb08-390c-437a-aed4-7b9feb7ff411`. Live read-only checks passed:
the login screen no longer includes a password-change form, unauthenticated
account-page access redirects to the fixed sign-in/return flow, the served script
contains that return route, the production administrator bundle includes the
reviewed password-page URL, and the administrator responds with 200. No database
migration, secret replacement or Collector redeployment was needed.

## Initial Better Auth production deployment — 2026-10-25

Deployed the administrator at `https://tallyfin-admin.rodisoft1.workers.dev`
and the provider at `https://tallyfin-auth.rodisoft1.workers.dev`. The Collector
has no public workers.dev route and is reached through the administrator's
private service binding. Analytics and authentication use separate D1 databases;
all 14 analytics migrations and the auth schema were applied remotely.

The selected initial account was bootstrapped privately. Its verified issuer
and subject received project-creation permission with a limit of 10 projects.
The initial password is stored outside Git using Windows user DPAPI, with a
local clipboard helper. No passwords, secrets, cookies or tokens are recorded
in this report or committed deployment files. Public signup and dynamic client
registration are closed.

- Real provider login, S256 PKCE, ID-token signature and Collector access-token
  verification passed. Auth health, administrator page, authenticated storage
  read and project-list read returned 200; unauthenticated API access returned
  401, and signup/dynamic registration returned 404.
- Chromium 156.0.8078.4 completed administrator → auth → callback → administrator
  against the deployed Workers. The project read returned 200, callback query
  parameters were removed, browser storage remained empty, and page errors were 0.
- Two successful live SQLite Durable Object alarm wakeups were observed, with
  the next alarm scheduled and private Collector maintenance RPC connected.
  No extra Cron slot or paid-plan upgrade was configured. Cleanup against a
  retained real-service dataset was not established by these wakeups.
- Public `install:check` passed required discovery, CORS, S256 and key checks.
  Its manual-readiness items are intentionally not automatic proof of login,
  permissions or deployment; the live checks above provide separate evidence.
- Local checks passed: auth/alarm runtime 5/5, OIDC 21/21, administrator 375/375,
  Sites Worker 11/11, contract/documentation checks 69/69, root typecheck,
  Wrangler dry runs, and production dependency audit (0 vulnerabilities).
  These counts overlap earlier records and are not added together.

Live sanitized reports and screenshots are in the ignored
`.tmp/production-20261025-live/` folder. The final static fallback fetches `/`
internally instead of `/index.html`, avoiding an ASSETS redirect that discarded
OIDC callback parameters; the Sites Worker regression suite passed afterward.

Publisher OIDC remains disabled. A live token-expiration/refresh wait, actual
service-event integration, production load, remote backup/recovery, custom-domain
DNS and recurring access alert delivery remain unverified. This deployment adds
auth-specific storage and an optional maintenance RPC/scheduler; existing analytics
HTTP and DB contracts are unchanged. No CI runner or hygiene policy was added.
The product spec, roadmap, risk register, installation/OIDC/runtime guides,
workspace boundaries and README were aligned with these results.

## Native Workers JWKS transport compatibility — 2026-10-25

Live PKCE login issued and validated an ID token, but Collector identity reads
returned 503 `storage_unavailable`. A temporary diagnostic restricted to the
public JWKS transport identified native Workers rejecting `redirect: "error"`
before any network request. The diagnostic was removed. JWKS transport now uses
`manual` and the existing 200-only response check, preserving redirect refusal.
Collector targets also explicitly allow public same-zone fetches through
`global_fetch_strictly_public` for the separately deployed auth Worker.

- `node --test --test-timeout=30000 packages/auth-oidc/test/*.test.ts`: 21/21
  passed, including actual Workers global-fetch/ES256 verification, rejected
  redirects, failure cooldown, cancellation and bounded key fetches.
- Deployment/auth-target checks: 4/4 passed.
- Full `npm run typecheck` passed after the alarm/RPC integration.

No analytics HTTP/DB schema, credential, CI or hygiene-policy changes. Live
verification after deploying the corrected transport is recorded separately.

## Free-plan maintenance scheduling — 2026-10-25

The authenticated provider deployed and real password login returned 200 with a
secure cookie. Registering another Cron failed because the account already uses
all five Free-plan Cron slots. Successful code/URL changes were not rolled back
by Cloudflare; this partial deployment was not treated as a complete rollout.

Added optional `collector.scheduler=auth-alarm`, retaining Cron by default for
other installations. A SQLite Durable Object in auth invokes the existing
bounded Collector cleanup through a private named service-binding RPC every
minute and cleans auth rate-limit keys at most hourly. Session-protected control
arms it explicitly. It persists the next wakeup before dependencies and records
fixed success/failure metadata without exposing identities or tokens.

- Auth and alarm runtime tests: 5/5 passed. A real Workers/SQLite alarm instance
  was armed repeatedly without resetting its schedule, called a separate
  Worker RPC, removed only expired keys, recorded injected dependency failure,
  retained its next wakeup, and recovered on the following invocation.
- Installation, target and auth-topology tests: 10/10 passed.
- Auth generated-binding type check: passed, including the cross-Worker RPC type.
- Collector and administrator type checks passed before that final auth check.
- Generated auth and Collector Wrangler dry runs: passed.
- Configured administrator rebuild: passed. Existing 375 administrator tests and
  the successful real-Chromium synthetic-provider login check remain applicable;
  no administrator source changed.

No paid upgrade, unrelated Worker/schedule change, scheduled CI runner, analytics
HTTP/DB schema change or new secret was needed. ADR 0009 and the installation
guide document the optional scheduler and activation/status checks. A live
alarm wakeup and the completed three-Worker rollout remain to be recorded below.

## Self-hosted Better Auth administrator provider — 2026-10-25

Added the optional `apps/auth` Worker, a separate Better Auth v1 D1 schema,
private idempotent administrator/client bootstrap, closed signup and management
routes, an administrator-email session gate, secure login/password-change pages,
ES256 OIDC PKCE and rotating refresh tokens. `auth:prepare` validates a separate
auth DB and the exact existing installation topology without changing the
five-file installation format. Root type checks now include the auth workspace.

- Auth tests: 4/4 passed (closed signup/idempotence, real PKCE/Collector verifier
  compatibility plus refresh rotation/replay refusal, second-account denial,
  and native Workers/D1 login, origin checks, cookie security, body cap and PII).
- Auth topology test: 1/1 passed, including shared-DB, client, issuer host,
  resource, algorithm, scope and private-field rejection.
- `npm run typecheck`: passed across Collector, administrator and auth.
- `npm run test:admin`: 375/375 passed.
- `npm run check --prefix tools/contracts`: 69/69 passed.
- Auth Wrangler dry run: passed, 2814.97 KiB / 479.65 KiB gzip before minification.
- Configured production administrator build: passed.
- `npm audit --omit=dev`: zero reported vulnerabilities in production dependencies.
- `git diff --check`: passed.

The Workers/D1 test also invoked the actual scheduled handler: an inactive
two-day-old rate-limit row was deleted and all current rows were retained.
The first remote upload rejected the local-calendar compatibility date as future
in UTC; both baseline and generated auth targets use 2026-10-24, the UTC date of
deployment. This rejection did not publish an auth implementation.

Source-of-truth changes: product specification, ADR 0009 and workspace boundaries.
Analytics OpenAPI/DBML contracts are unchanged; authentication owns its separate
upstream schema snapshot. Better Auth and its OAuth plugin are new major-v1
runtime dependencies. No CI runners or hygiene policies changed. Remote resources
and migrations were authorized for the initial installation: two isolated D1s,
one auth migration and fourteen analytics migrations applied. Initial credentials
are protected outside Git with Windows user DPAPI, never printed. Deployment and
live verification are recorded separately when completed. Full unrelated backend
and SDK suites were not rerun; no ingestion or SDK code changed.

This guide explains which commands to use to verify Tallyfin changes. The commands below are based on the scripts declared in `package.json` at the repository root, `apps/admin/package.json`, and `tools/contracts/package.json`.

Inline paths in commands and validation records are resolved from the repository root unless stated otherwise (paths such as `apps/admin/...` are also under the root). Dated reports in root documents and `docs/validation/history-NN.md` are evidence from when they were written. They do not automatically replace current code or the current remote state, so reproduce them with a new record using the same commands and scope.

Keep this work's validation results in the latest record below and preserve older records in history files split in their original order. Keep the original section order and sentences, changing only Markdown links to match their new locations. Keep a history index and command guide at the root. As new records accumulate, move older ranges into history.

This round of verification covers only the relevant suite and scope. Record only the targets actually executed and the result scope, and do not use unexecuted full checks or a successful deployment as a generic pass.

| Stable name | Command | Selection criteria |
| --- | --- | --- |
| typecheck | root `npm run typecheck`; admin `npm run typecheck:admin` | The root command combines collector, root, and admin type checks. When only admin changed, choose the admin command first. |
| test | root `npm test`; admin `npm run test:admin` | Choose the scope that matches the changed package, app, or tool boundary. |
| contract/docs | `npm run check --prefix tools/contracts` | Checks examples, DBML, and documentation links. It is not evidence of runtime behavior. |
| lint | `npm run lint --prefix tools/contracts` | Checks OpenAPI only. General source lint is not configured separately. |
| build | `npm run build:admin` | Checks the composition of the admin deployment output. |
| migration-check/smoke | `npm run verify:restore`; related `verify:admin-*` | Opt-in synthetic and local checks. They do not prove remote migration or deployment state. |
| check | root `npm run check`; admin `npm run check:admin` | Broad combined scope. Run only when needed. |

There is no independent `format` script. Follow `.editorconfig` and `.gitattributes`, and check whitespace and line endings in changed files with `git diff --check`.

The scope recorded in a result must match what the command actually examined. If only a related suite was run, record that suite; if only some paths were checked, record those paths.

## Apache-2.0 License Adoption — 2026-10-25

Adopted Apache-2.0 using the official license text in the canonical root `LICENSE` and a root `NOTICE` with `Copyright 2026 Rodisoft`. Updated 10 first-party package manifests and 3 lockfiles to Apache-2.0, preserving private flags, versions, scripts, and the dependency graph. Browser and server package roots include exact copies of `LICENSE` and `NOTICE`. Updated the product specification, roadmap, and risk register, and annotated historical ADR 0001 with the current license decision. Existing third-party notices are unchanged.

- `npm run check --prefix tools/contracts`: 69/69 passed.
- `npm run verify:sdk-packages`: `verified: true`. Offline tarballs contain 10 browser files and 6 server files. Actual installs outside the checkout verified Apache-2.0 metadata, byte-exact `LICENSE`/`NOTICE`, types, and all 3 ESM entry points, with `networkRequests: 0` and `credentialRequests: 0`. Report: `.tmp/sdk-packages/run-NnAREH/report.json`.
- One-off deep JSON comparisons of the 10 manifests and 3 lockfiles passed: only license metadata and `NOTICE` inclusion changed; transitive dependencies are unchanged.
- `node --check tools/sdk/verify-packages.mjs` and `git diff --check`: passed.

Broader application, real-provider, and remote suites were skipped because no runtime or API/DB logic changed. API/DB contracts, dependency versions, CI/runners, and repository hygiene policies are unchanged; the only tooling change enhances the optional SDK packaging verification. No push, npm publication, deployment, or repository visibility change was performed.

## English Documentation for Public Release — 2026-10-25

Audited 149 tracked Markdown and text documents and translated 88 in place, covering public guides, product and architecture decisions, backend and SDK contracts, operations, and validation history. Historical evidence retains its original scope; local verification does not imply production deployment. Translated headings have matching internal links, and the admin guide explains that the current UI uses Korean.

- `npm run check --prefix tools/contracts`: 69/69 passed.
- `git diff --check 8b5c35f`: passed across the documentation changes.
- The full tracked-document scan found no remaining Hangul; local document paths and heading links resolve.
- Source comparisons checked heading structure, checkbox states, tables, code samples, numeric evidence, and commands, including hard-wrapped command spans.

Application tests, builds, real-provider checks, and remote operations were not rerun for this documentation-only change. Application code, API/DB contracts, dependencies, hygiene, and CI are unchanged. License selection, repository visibility, package publication, and deployment remain separate work.

## Reuse of project date formatters — 2026-10-24

In `packages/core/src/calendar-date.ts`, `localDate` and `dateEnd` share an `Intl.DateTimeFormat` with a fixed locale and date options. Formatters for each timezone are reused up to a maximum of 32 with an LRU, and date results and project or request data are not cached. Existing signatures, the `dateEnd` binary search, and DST decisions are retained, and an invalid zone failure does not evict a cache entry.

- `npm run test:core`: 57/57 passed. `npx tsc --noEmit`: passed.
- The 3 new tests in `packages/core/test/calendar-date.test.ts` cover just before and after project-local midnight, month and year boundaries, 23 and 25-hour DST, the Lord Howe 30-minute transition, the skipped day in Apia, leap day, an invalid zone, the 32-entry cap and LRU, and actual date calculation on every call.
- In the first run of 26 D1-related tests, 17 in `storage.test.ts` and 3 in `funnel-dimensions.test.ts` passed. The 2 existing `breakdown-dates.test.ts` tests expected a generation count of 31 and failed at 1/0 after the change; this was not a product defect. After fixing them to check that actual `Intl.formatToParts` calls are equal at bucket 1 and 32, that at most 1 formatter is created, and that empty-result conversion is 0, `node --test packages/storage-d1/test/breakdown-dates.test.ts`: 6/6 passed.
- On Node v24.18.0, the local isolated helper `.tmp/calendar-date-bench.mjs` produced the same results as a copy of the pre-change functions. The median of 7 alternating before/after runs was 142.002ms to 15.0816ms for 1000 `localDate` calls and 8.8236ms to 4.922ms for 31 `dateEnd` calls, while formatter creation for 1000+31 cold calls in one timezone went from 1031 to 1. These are local helper measurements and do not mean a reduction in full production request latency.

There are no API or DB contract, dependency, CI, or repository hygiene changes. Full backend and admin UI builds, remote load, deployment, and push were not run, and general source lint is not configured.
The final `git diff --check` also passed.

## Server draft upgrade of an existing DB and documentation wrap-up — 2026-10-24

This verified the path that brings the 0014 draft table into an existing installed DB and the draft saving behavior, and wrapped up the product and operations documentation for the server draft work. The product spec, roadmap, frontend design, risk register, and migration README were updated to match the current implementation. The draft API and DB addition contract was implemented in the previous two commits, and this wrap-up changed only tests and documentation.

- `node --test --test-timeout=30000 apps/collector/test/saved-schema-draft.test.ts`: 7/7 passed. On an existing DB with project and schema rows but no 0014 table, it verified dry-run, apply, a reinitialization no-op, preservation of existing rows, and `GET draft=null`.
- `npm run check --prefix tools/contracts`: 69/69 passed.
- The earlier `npm run verify:restore` run passed export and restore for 17 tables including draft rows.
- The 375/375 admin tests, type, build, 2/2 bundle checks, and 8 browser scenarios follow the execution results in the immediate `Server draft screen and concurrent edit recovery` record below.

In the earlier full backend parallel run, the provision CLI and restore-fingerprint each exceeded the 30-second limit once. When rerun alone, the provision CLI passed with `--test-timeout=90000` and restore-fingerprint passed 2/2, but this is not counted as a full backend pass. Real OIDC, remote D1, remote migration, push, and deployment were not run, and production behavior remains unverified. There are no dependency, CI, or repository hygiene changes.

## Server draft screen and concurrent edit recovery — 2026-10-24

In the settings ServerSchemaDraft, the owner explicitly confirms, saves, and loads. It does not save before a new query, and a conflicting, lost, or cancelled write is not resent automatically. After checking the server result and current input, the owner chooses to load from the server or keep the current input and review the next save; the latter does not write. It does not unconditionally overwrite content saved earlier on another device. Loading resets validation and privacy review, while saving preserves those confirmations. Input edited after submission is not treated as saved by an earlier success.

- `node --test apps/admin/src/api/saved-draft.test.mjs apps/admin/src/api/schema.test.mjs`: 45/45 passed.
- `npm run test:admin`: 375/375 passed.
- `npm run typecheck:admin` and `npm run build:admin`: passed on the final source.
- `npm run verify:admin-server-draft`: 8 scenarios passed on Chromium 156.0.8078.4. With synthetic OIDC and actual local D1, it verified explicit creation, restoration in a new session and after refresh, a CAS conflict with another owner, preservation of review, response loss after commit and read confirmation, preservation of new input after delayed success, refresh during save, and the 390px screen and owner-to-reader recheck. It recorded 6 writes, 6 reads, 0 unwanted navigation warnings, and 0 pageErrors. Query recovery did not increase the write count, and the number of published versions stayed at 1. The report and screens are in `.tmp/admin-server-draft-ELaSH2/`.

The save-immediately-then-leave warning race found by the browser check was fixed by reflecting save confirmation synchronously and reading the latest hasUnsavedChanges at event time. The required signature of the existing leave hook and the activation conditions on other screens were retained, and only an optional live check was added. After a refresh, when an existing published review adjusted the version input to the next number, the notice now distinguishes saved input from current input. An expectation error during the first check and a cold Vite loading wait were separate verification fixes and were not counted as passes. Server save and load are separate from the file feature, and input-replacement confirmation and unpublished-change protection remain after server save confirmation. The API and DB addition contract is in the earlier records, and there are no remote changes.

## Shared server draft storage contract, DB, and API — 2026-10-24

In accordance with ADR 0008, this added an owner-only GET/PUT schemas/draft endpoint and the 0014 table. Authentication and permission are checked before the body, and permission and expectedRevision are checked again inside the CAS INSERT or UPDATE. There is one row per project, incomplete JSON and empty versions are preserved, and a new revision prevents races. Draft text and review confirmation are not included in logs or admin history, and publishing, aggregation, settings, and ingest revisions do not change.

- `node --test --test-timeout=30000 apps/collector/test/saved-schema-draft.test.ts tools/provision/test/migrations.test.ts`: 8/8 passed.
  Concurrent creation and updates from different Collector instances each produced 1 success and 3 409s. The tests verified a permission race, reader denial, the 128KiB file boundary, incomplete Korean characters and empty values, DB constraints, and cascade deletion.
- `npm run typecheck`: passed.
- `npm run check --prefix tools/contracts`: 69/69 passed.
- `npm run lint --prefix tools/contracts`: passed.
- The recovery fixture was expanded to 17 tables including draft rows. Actual export and restore and the admin screen are verified in later units. There are no remote DB, deployment, dependency, or CI changes.

## Draft file import usability and read lifetime — 2026-10-24

Browser file reading was split into `api/read-schema-draft-file.ts`. Files over 128KiB are rejected before reading, and the ArrayBuffer is decoded in UTF-8 fatal mode so invalid bytes are not replaced with replacement characters. A UTF-8 BOM is allowed, and the draft body is preserved as entered. Success, failure, cancellation, and the 10-second timeout all release timers, event handlers, and AbortSignal listeners and abort an in-progress FileReader.

- `node --test apps/admin/src/api/read-schema-draft-file.test.mjs apps/admin/src/api/schema-draft-file.test.mjs`: 9/9 passed.
- The new read tests cover exactly 128KiB and just over it, incomplete Korean characters and a BOM, invalid UTF-8, a late callback after cancellation, timeout, the cause of file errors and synchronous exceptions, pre-cancellation, and an empty file.
- `npm run typecheck:admin`: passed.
- `npm run test:admin`: 366/366 passed, including 7 new read tests.
- `npm run build:admin`: passed.
- `npm run check --prefix tools/contracts`: 68/68 passed. This checks links and contracts and is distinct from runtime evidence.
- `npm run verify:admin-onboarding`: passed on Chromium 156.0.8078.4 with synthetic OIDC and actual local D1.
  The draft file checks covered just before, exactly, and just over 128KiB, an empty file, invalid JSON, another project, invalid UTF-8, error focus, reselecting the same file, cancelling and approving replacement, and restoring incomplete Korean characters and an empty version. Cancelling a user read, an actual 10-second timeout, a refresh, and an owner-to-reader recheck aborted the reader 4 times in total, and calling a released handler late did not overwrite the existing input or review state. File read delay and disk errors were injected through the browser's controlled FileReader, while normal file reading and downloading and UTF-8 and size checks used actual browser APIs. One additional POST was an explicit draft validation, and file import did not call the API. First event collection and a query of 1 record also passed, with pageErrors 0 and routeError false. The report and desktop and 390px screens are in `.tmp/admin-onboarding-eLHlOd/`.
  The first run failed while waiting for the login button on the initial lazy-loading screen, and the same command was rerun alone after the other checks and passed. The timeout was not increased and product behavior was not changed.
- `git diff --check`: passed.

This added the file name being read, a cancel button, and a replacement-cancellation notice. On error, focus moves to the notice, and existing input and review state are retained on failure or cancellation. The editor is subscribed synchronously so a change in list, validation, publishing, or permission state aborts reading even before React effect cleanup. Unmounting and changing the project or editor also cancel, and a late completion does not clear the state of a new read. A rejected import is not displayed as successful. The spec and frontend design were updated. There are no changes to file format, API, DB, SDK, dependencies, CI runners, or repository hygiene settings. The existing opt-in onboarding browser check was extended and no new command was added. The full backend and SDK suites and remote authentication and deployment were not run because they were outside the relevant scope.

## Definition comparison across schema versions — 2026-10-24

Comparison of published definitions was split into an I/O-free React calculation in `schema-comparison.ts` and reads of two versions. Events, properties, workflows, and funnels are matched by name or ID, and per-field additions, removals, and changes, the representative workflow, and array order are preserved. Object key order is ignored, and omitted funnels are equal to an empty array. Result values are copied from the input. The query uses only the existing getSchema, and the other read is cancelled when one side fails or is cancelled. Request identity and version are checked, and a late response that ignores cancellation is rejected. There is no automatic retry, write, or API or DB contract change.

- `node --test apps/admin/src/api/schema-comparison.test.mjs`: 12/12 passed.
- `npm run typecheck:admin`: passed, including the final UI.
- `npm run test:admin`: 359/359 passed, including the 12 new comparison tests.
- `npm run build:admin`: passed, including the final UI.
- `npm run test:bundle --workspace @tallyfin/admin`: 2/2 passed. Settings comparison follows the existing lazy-loading boundary.
- `npm run check --prefix tools/contracts`: 68/68 passed. This is distinct from runtime behavior verification.
- `npm run verify:admin-schema-comparison`: 10 scenarios passed on Chromium 156.0.8078.4.
  With synthetic OIDC, actual local D1, and 27 versions, it verified pagination and an inactive version, preservation of draft, validation, and privacy review, reverse and same-version comparisons, identical definitions, 503 and explicit retry, a late response after a selection change, project changes, reader queries, the 390px screen, and actual permission revocation. Comparison added 0 writes and 0 page errors. The single draft-validation POST is counted separately from comparison writes.
  The final report and screens are in `.tmp/admin-schema-comparison-kqrl5v/`. The last assertion of the first run failed because it counted the draft-validation POST as a write; it was changed to use the increase before and after the comparison and rerun successfully.
- `git diff --check`: passed.

A per-field difference table for two published versions was connected in settings. It uses a selection and query lifetime independent of the draft, and hides previous results and cancels the request when permissions, list lock, selection, project, or session change. Errors show a retry instead of the previous result. It distinguishes reader queries, inactive versions, too few versions, and identical definitions. The table provides keyboard horizontal scrolling and row and column headers, and the mobile selection is stacked vertically. Funnel steps are shown by number, event, and source, and the complete definition with additions and deletions can be expanded. Definition comparison is not a compatibility judgment or a comparison of aggregates across versions.

Remote connection and deployment and the full backend and SDK suites were not run because no related code changed. There are no API, DB, SDK, dependency, CI runner, or repository hygiene changes, and one opt-in browser verification was added to the local commands. The product spec, roadmap, risk register, and frontend design were updated to match the current implementation.

## Validation record split and maintenance review — 2026-10-23

Of the existing 229 sections, the latest 3 remain in this file and the other 226 were split into 16 history files under 32KiB. Titles, bodies, and order were preserved, and only relative Markdown links were adjusted to their new locations. The body was compared with the source after restoring links to their original locations to confirm that there were no omissions, duplicates, or changes. Links in history files were included in the existing contract check and 68/68 passed.

The review examined the full source list and file sizes, Core transitions, D1 atomic writes, Collector resource lifetime, and SDK input copies and delivery boundaries. The SDK size budget and existing pure calculations and injection ports were retained, and the migration list, admin transport, and dashboard calculations, which have a high cost of change, were separated. Executed checks and unverified production scope are separated in the next three records.

The command guide was aligned with the current package scripts. Past prototype paths, older test counts, and older budgets are preserved only in history. No API or DB contract, dependency, CI runner, repository hygiene setting, or remote environment was changed.

## Dashboard calculation and CSV preparation split, and integration check — 2026-10-23

LiveDashboard's event row and daily record calculation and CSV preparation were split into I/O-free React modules. Event names are compared with Map and Set, and unregistered response order after definition order is preserved. The existing last-value rule for duplicate totals, 0 versus null, different sources, search, and argument immutability are preserved. CSV locking is an early return in this order: current data, current workflow error, previous workflow error, comparison scope and query, event detail and property comparison, and workflow classification. The existing controller remains the owner of query, permission, and scope state.

The focused pure-calculation tests passed 3/3, the final full admin tests 347/347, admin type and build, 2/2 bundle, 11/11 Sites, and 68/68 contract and documentation links. Overlapping check counts are not added together. The checks verified frozen arguments, incomplete data, concurrent block-reason priority, inclusion of only completed query selections, exclusion of settings CSV, and actual CSV generation.

The existing `verify:admin-analysis-access` assertion for the last CSV column did not reflect recently added columns and failed in other-project. It was fixed to compare the full current CSV_COLUMNS headers with the actual file, and the final Chromium 156.0.8078.4 run with a synthetic login and actual D1 passed latest-version, project-isolation, size and timezone recovery, event table, permission revocation and recovery, CSV blocking, late rejection, and disconnection checks. It recorded 43 reads, 0 writes, 0 pageErrors, and routeError false, and the evidence is in `.tmp/admin-analysis-access-uQa6jk/report.json`.

`verify:admin-goal-access` also passed 16 scenarios on the same Chromium with a synthetic login and actual D1. It verified current and previous period classification, funnels, duration and failure causes, partial failure, CSV locking, 7 actual permission-revocation paths, late responses, and recovery. It recorded 116 reads and 2 writes, which were the existing draft-validation POST; no publishing or collection occurred. pageErrors were 0 and routeError was false, and the evidence is in `.tmp/admin-goal-access-LTlb4K/report.json`. Overview and goal desktop and 390px captures were checked. The test browser, Vite, and Miniflare processes were cleaned up.

No product or HTTP API, DB, SDK contract, dependency, retention policy, repository hygiene, or CI runner was changed. The frontend design and this record were updated. The unchanged full backend, real provider and production load, and remote DB were not repeated, and there is no general source lint command. There were no pushes, deployments, or remote changes.

## Administrator transport and error policy split — 2026-10-23

The required ApiClient signatures, constant and type exports, and ApiError class identity were retained, and endpoint validation and AdminTransport's token, request queue, deadline, cancellation, and body cleanup lifetime were separated. Lower-level calculations, parsers, and editors now read ApiError from a separate error module to reduce runtime circular dependencies with the client. Exceptions from the permission-loss observation callback do not override a confirmed 401 or 403. destroy releases callback references first, calls onDestroy, and retains existing error propagation.

Focused client and request-lifetime tests passed 66/66, and follow-up lifetime, queue, and observation tests passed 33/33. Admin type, build, 2/2 bundle, and 11/11 Sites also passed. In the full check, an existing test that mixed virtual timers with the real monotonic clock failed once because of CPU contention (346/347). After changing it to control both clocks together, all 347/347 admin tests passed. The check scopes overlap, so the counts are not added together. The tests verified original causes, cancellation reasons, response size, concurrency limits, absence of write retries, discarding, and late responses, and include new observation and discard exception tests.

There are no API or DB contract, dependency, repository hygiene, or CI runner changes. Browser integration is recorded with the dashboard calculation split in the next record. The unchanged full backend, real provider, and remote DB checks were not repeated, and there is no general source lint command. There were no pushes, deployments, or remote changes.

## Migration list and SQL splitting commonization — 2026-10-23

The provisioning tool, storage test fixtures, and restore report use the same reviewed migration list and SQL splitting functions. If the SQL in the actual directory differs from the list, provisioning fails before the DB query or apply step. Trigger bodies, application order, and raw SQL hashes are preserved, and reading the new list does not share the array.

The fixed 11 assertions in the existing installation metadata test were reproduced failing at the current 13 before the fix. After changing it to compare the full current list, root `npx tsc --noEmit` and 17/17 migration, provisioning, installation check, duration, and failure-reason tests passed. The tests include a missing, extra, or duplicate list entry, trigger splitting, atomic rollback, reinitialization, the local CLI, and checks for missing or changed schema in actual D1.

There are no SQL file, API or DB contract, dependency, CI runner, or repository hygiene changes. Remote application was not performed. The unchanged full test suite and full restore rehearsal were not repeated; related actual D1 checks were used instead. There is no general source lint command, and the repository SQL splitter follows the existing rule of not splitting on quoted semicolons.

## Previous validation records

Original section order is preserved and has not been re-sorted by date. Passes in a record apply only to the execution scope at that time.

| File | Records | First record |
| --- | ---: | --- |
| [history-01.md](docs/validation/history-01.md) | 15 | Current implementation and operations documentation cross-check — 2026-10-23 |
| [history-02.md](docs/validation/history-02.md) | 24 | Query criteria, actual periods, and date-change guidance in the integration overview (2026-10-23) |
| [history-03.md](docs/validation/history-03.md) | 26 | Final verification of resource lifetime and race improvements (2026-10-23) |
| [history-04.md](docs/validation/history-04.md) | 10 | Forced synchronous delay in administrator request limits (2026-10-12) |
| [history-05.md](docs/validation/history-05.md) | 14 | Real-browser verification of failure before settings save and response loss after save (2026-10-12) |
| [history-06.md](docs/validation/history-06.md) | 12 | Permission refresh between settings and schema — 2026-10-12 |
| [history-07.md](docs/validation/history-07.md) | 13 | Concurrent load with retained data and 3 collector Workers — 2026-10-11 |
| [history-08.md](docs/validation/history-08.md) | 11 | Log-based diagnosis — 2026-10-11 |
| [history-09.md](docs/validation/history-09.md) | 14 | Administrator server publisher screen — 2026-10-11 |
| [history-10.md](docs/validation/history-10.md) | 13 | Administrator build from a settings bundle — 2026-10-11 |
| [history-11.md](docs/validation/history-11.md) | 13 | Server SDK funnel link delivery — 2026-10-11 |
| [history-12.md](docs/validation/history-12.md) | 15 | Authenticated server event ingestion API — 2026-10-11 |
| [history-13.md](docs/validation/history-13.md) | 17 | Browser SDK |
| [history-14.md](docs/validation/history-14.md) | 10 | Administrator event basic information edit form, 2026-10-09 |
| [history-15.md](docs/validation/history-15.md) | 10 | Rejection cause collection and administrator query connection, 2026-10-10 |
| [history-16.md](docs/validation/history-16.md) | 9 | Administrator request wait and cancellation improvement — 2026-10-11 |
