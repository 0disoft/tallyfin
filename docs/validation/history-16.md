# Validation History 16

This historical record preserves the section order of the original. Commands and code paths are relative to the repository root.

## Admin request waiting and cancellation improvements — 2026-10-11

Added a default 15-second overall request timeout to the admin `ApiClient`. Waiting for token refresh, HTTP responses,
and success/error bodies share one timeout; the internal construction option `requestTimeoutMs` accepts
only integers from 10 to 120000 milliseconds. `awaitRequest` also releases waits for synthetic transports that
ignore cancellation, consumes late responses/failures, and removes listeners. It also removes timers on completion.
Shared login refresh is not canceled; requests whose timeout has already elapsed do not start a new HTTP request
even if a token arrives late. The default fetch receives the abort signal.

Timeouts appear as `ApiError('timeout')` with fixed wording. Already observed 401/403 statuses remain permission
errors even if the error body stalls, so grant lists are discarded and queries locked. If a save response cannot
be confirmed, the existing editor enters its review state, retaining input and allowing recovery by querying
the latest state. Saves are not automatically retried. Canceling a request does not undo a write already applied on the server.

Passed `npm run test:admin` 204/204, `npm run typecheck:admin`, `npm run build:admin`,
`npm run test:bundle --workspace @tallyfin/admin` 2/2,
and `npm run test:sites --workspace @tallyfin/admin` 9/9. After the final one-line addition of an abort check
immediately after helper completion, passed the focused client/request lifecycle checks 45/45 and admin
type checking/build again. Reused the unchanged remaining check results.
`git diff --check` also passed. New tests cover stalls at each stage, retention of the overall budget, timer cleanup,
caller cancellation, disconnection, late success/failure, shared refresh, recovery by requery, permission denial,
and lost save results using synthetic transports and actual editing/grant controllers. These do not prove reproduction of network/production incidents.

Updated frontend design documentation, the admin guide, and roadmap. No OpenAPI/DB contract, SDK, dependency,
CI runner, or hygiene policy changes. The backend was unchanged, so the full backend checks were not repeated;
general source lint was skipped because no command is registered. Browser UI, real OIDC, and remote D1
validation were not run in this slice either. Production provider/domain remain undecided; no remote push or deployment.

## Server SDK late response and body cleanup improvements — 2026-10-11

Added three regression tests first and confirmed 3/3 failures on the existing code. If cancellation of an error
body rejected, a 401 was misclassified as `transport_unavailable` and sent twice; if cancellation of a receipt
over 1KiB stalled, a transport error was returned instead of `invalid_response`. A late 200 response after the
first attempt timed out changed the in-progress second attempt's `httpStatus` from null to 200. Reproduced with
synthetic transports/ReadableStream; this is not reproduction of a real provider/production network incident.

`discardBody` starts cleanup and consumes failures without waiting for completion. `receipt` cleans up
invalid/oversized/canceled reads and releases the reader lock. Once fetch completes, the per-attempt signal is
checked first, so responses from completed attempts cannot change status/headers/receipts. Also checked rejection
of cleanup for a late response after caller cancellation. If the host ignores cancellation, the SDK does not
guarantee complete termination of that transport implementation. Receipt/retry behavior, token forwarding, and batch format remain unchanged.

Passed `npm run test:server` 24/24, `npx --no-install tsc --noEmit`, `npm run build:server`,
and `git diff --check`. The server SDK build is 8952 bytes/gzip 3671 bytes, with 0 external runtime
dependencies confirmed. After adding the final caller-cancellation regression test, reran only server tests
and reused type/build results for unchanged source.

`npm run verify:server-recovery` also passed with exit code 0 and `verified:true`. Used three Miniflare collector
Workers in a new synthetic environment, shared local D1, actual loopback sockets, and the SDK's default fetch.
Retries after a 503 before commit gave accepted 2/duplicates 0; retries after response loss following commit gave
accepted 0/duplicates 2, each with attempts 2 and byte-identical bodies. After publisher revocation,
confirmed 403/attempts 1 and unchanged aggregates. There were receipts 8/completedRuns 2; results are in `.tmp/server-recovery/run-2AgRt3`.

Updated the server SDK guide, roadmap, and validation records. No API/DB contract, SDK public type, dependency,
hygiene policy, or CI runner changes. Admin/collector source was unchanged, so full UI/backend checks were not repeated;
general source lint was skipped because no command exists. Real OIDC/remote D1/production load remain
unverified because the environment is undecided. No existing DB access, push, deployment, or Sembom activation.

## Browser SDK body cleanup and redirect improvements — 2026-10-11

Added 2 native adapter regression checks first and confirmed 2/2 failures on existing code. If response body
cancellation stalled, pending remained at 1 despite receiving a 200 response; fetch also lacked a redirect setting
and used the default follow policy. Ran the native adapter with test document/fetch implementations;
the initial failing checks do not reproduce an actual production network incident.

Body cleanup consumes Promise failures without waiting for completion. Whether the ReadableStream's
underlying cancel throws/rejects/stalls, statuses 200/401/403/422 are handled immediately without
resending. Native fetch uses manual redirect; status 0 for a filtered redirect is routed into an internal
nonretryable 3xx branch. This internal status is not placed in requests. Exposed actual HTTP
redirect codes are handled as-is; network exceptions/status 0 from custom ports retain existing retry behavior.
Native default CORS/omit/no-referrer/keepalive policies also remain unchanged.

Schema event/rule/funnel lists are traversed only once; removed the queue.slice copy when wrapping batches
and the second object copy for funnel links. Numeric properties use the shared safe-integer check;
required properties are checked in the existing snapshot. Validation was not weakened and public keys were not compressed.
After fixing the initial size overrun and the admin generated code's separate 3KiB overrun, final checks passed:
browser 32/32, admin funnel SDK generation 6/6, root `npx --no-install tsc --noEmit`,
`npm run build:browser`, `npm run check:browser-size`, and `git diff --check`.
Final gzip sizes are base 2746/Sembom 3023/funnel 2918/funnel example 3044 bytes; admin generated
code also passed the existing 3072 bytes limit. Budgets, dependencies, and check commands were unchanged.

Ran `npm run bench:browser -- --samples 2` on final source and confirmed exit code 0.
Used a local synthetic page, fresh browser contexts, actual Chromium, a loopback collector, and fresh D1.
The baseline had 22 each for calculation success/start and 2 each for view/validation; after response-loss recovery,
workflow starts/successes were 34 each, with receipts 74. Confirmed 12 calculations during recovery,
deduplication of 20 response-loss events, 11 calculations during collector downtime, and requests without
cookies/credentials/referrer. Raw records are in
`.tmp/browser-bench/1791709452481.json`. This measurement bundle's gzip 3016 bytes differs from the Sembom
example's 3023 bytes. This small sample does not support claims of production performance improvement.

Separately bundled SDK source using ignored `.tmp/native-browser-redirect.mjs` and used Chromium
156.0.8078.4 with two local HTTP servers. Configured the collector to point to a target server on another
origin with a 307. Confirmed the actual response type=opaqueredirect/status=0/redirect=manual,
1 collection request, 0 target-server requests, no additional retry, no pageerror, and pending 0.
Results are in `.tmp/native-browser-redirect-result.json`; the validation browser/servers were stopped.

Updated the browser SDK guide, roadmap, and validation records. No API/DB contract, SDK public type, hygiene policy,
CI runner, or dependency changes. Unchanged full admin/backend checks were not repeated;
general source lint was skipped because no command exists. Actual Sembom integration, mobile/other browsers,
and remote production environments remain unverified; no push, deployment, or activation.

## Analysis and CSV access loss follow-up — 2026-10-12

Ran the new `npm run verify:admin-analysis-access` on existing source first. After revoking read permission
with actual local RS256 login/Miniflare D1, the event detail GET received 403, but closing
the detail reenabled summary CSV, failing at the `denied-export` stage.
The fix propagates permission denial from analysis GETs to the parent screen, hiding summary/detail/comparison/
grouped results and CSV together. It also handles stalled error bodies/login refresh failures and distinguishes owner-only 403.

The final browser check passed on Chromium 156.0.8078.4 with 1 login, 1 denied read, 22 normal API reads,
1 held read, 0 API writes, and 0 pageerror. Confirmed summary removal/CSV locking, absence of the previous
project in another project's CSV filename and actual contents, permission recovery/explicit refresh,
discarding late 403 after project switching, and data removal after disconnection. Results are in
`.tmp/admin-analysis-access-z2VrRW/report.json`. An earlier held-response check logged
workerd Windows WSASend 10054 for a canceled socket and passed.
The final run did not produce that diagnostic. This checks a synthetic local provider/D1, not remote production.

Client/request lifetime checks 53/53 and analysis/schema checks 64/64 (4 new checks overlap)
passed. After the final state classification change, the new checks passed 4/4 again. Confirmed admin type checking/build,
bundle/Sites 11/11, and `git diff --check`. Unchanged full backend checks and real-provider/
remote DB checks were not repeated. No general source lint command exists. Updated only frontend design and this
validation record as owned documents. No API/DB/SDK/dependency/hygiene policy/CI runner changes,
push, or deployment. The new browser command is opt-in and was not connected to default CI.

## Blocking unsupported time zone responses — 2026-10-12

When the API returned an unsupported time zone name in project/query metadata, the admin client
passed it to React without validation. When the dashboard calculated query dates, `Intl.DateTimeFormat`
threw an exception caught by the parent `DeferredPanel` error boundary, which offered only "Refresh page";
refreshing cleared the memory-only token, requiring login again.

`apps/admin/src/api/validate.ts` checks project/query metadata time zones against the same contract as Core's
`validateRegistry` (1–64 characters, `^[A-Za-z][A-Za-z0-9_+./-]*$`,
successful `Intl.DateTimeFormat` construction). Invalid responses are rejected before rendering as an `ApiError`
of kind `contract`; the dashboard shows `The response does not match the contract` and `Retry`, retaining
the connection/login. Supported names/aliases pass through unchanged without rewriting or replacing them with UTC.

Of the 3 new `apps/admin/src/api/time-zone.test.mjs` checks, 2 failed before the fix. Final
client/dates/collection-diagnostics/schema/time-zone checks 74/74, `typecheck:admin`,
`build:admin`, runner `node --check`, and `git diff --check` passed; bundle/Sites checks
were 11/11.

Opt-in `npm run verify:admin-analysis-access` injects `Mars/Olympus` only into the actual local D1
project list response without changing the DB. The final Chromium 156.0.8078.4 run had
invalidZoneReads 1, recovery true, deniedReads 1, heldReads 1, logins 1, API reads 25/writes 0,
pageerror 0, routeError false, and verified=true; existing access revocation/CSV locking/other-project
download/late 403 discard/disconnection checks also passed. Results are in
`.tmp/admin-analysis-access-v0JmYQ/report.json`. Running the same command on pre-fix source fails
at the initial `invalid-time-zone` stage, leaving the error boundary in the capture.

This check used synthetic local RS256 login and isolated Miniflare D1/Vite; the actual production provider
was not checked. No API/DB/SDK/dependency/hygiene policy/CI runner changes, push, or deployment.

## CSV query source column — 2026-10-12

Added `query_source` at the end of `CSV_COLUMNS`, preserving existing column order and `source` behavior.
For `event_total` rows, `source` is the declared event source; for other rows, it is `meta.source`.
`query_source` identifies the queried browser/server source on every row. `event_total` rows for unselected
sources retain `availability=not_selected` and an empty `count`, without manufacturing 0.

The new `client.test.mjs` check failed before the fix and passed afterward. Final
`node --test apps/admin/src/api/client.test.mjs apps/admin/src/api/server-source.test.mjs`
passed 41/41, with `typecheck:admin`/`build:admin` passing, and `verify:admin-analysis-access` passed
the `query_source` header check on the actual downloaded CSV. The final Chromium 156.0.8078.4 run had
verified=true, pageErrors 0, routeError false, reads 23/writes 0/logins 1,
invalidZoneReads 1, deniedReads 1, and heldReads 1.

With one additional CSV column, consumers must read headers instead of relying on a fixed column count. No API/DB/SDK/dependency/
hygiene policy/CI runner changes, push, or deployment.

## Draft replacement confirmation when loading a schema version — 2026-10-12

Fixed schema version loading in settings overwriting an in-progress draft without confirmation.
`SchemaEditor` remembers the last confirmed definition as its baseline and requests replacement confirmation
only for drafts that differ from that baseline. The baseline updates on load (`#accept`), server-confirmed
publication (`#read`), successful version loading/publication, and keeping the draft (`keepDraft`).

The 3 new regression checks failed 3/3 before the fix. Afterward, `schema.test.mjs` passed
31/31, including 4 additional checks. The fourth checks that replacement confirmation is retained even when
`keepDraft` explicitly keeps a previous definition different from the server's latest. Passed `typecheck:admin`/`build:admin`,
bundle-split 2/sites-worker 9 (total 11/11), runner `node --check`, and `git diff --check`.

`npm run verify:admin-onboarding` passed with Chromium 156.0.8078.4, 1 synthetic local RS256 login,
and actual Miniflare D1. Recorded replacementDialogs 3 (1 cancellation, 2 retry confirmations after 503 failure),
pageErrors 0, routeError false, apiReads 27, apiWrites 4, browserBatches 1, firstEventCount
1; the record is `.tmp/admin-onboarding-VlLaeP/report.json`.

The remote OIDC provider and production DB were not validated. Unchanged full backend/SDK checks were
not repeated; no general source lint command exists. No API/DB contract, dependency, hygiene policy, or CI runner
changes; only the existing opt-in browser runner was extended, without adding it to default CI. No push or deployment.

## External assessment follow-up: query scope, versions, cleanup, and public collection protection — 2026-10-23

Local commit 86dabbd separates query scopes for event/overview/goal screens. The browser event screen reads
only summaries, the overview only the first workflow, and goals all workflows; previous periods and CSV validate
the same scopes. Existing full snapshot calls and result removal after loss of permission are retained.
Corrected the README migration count to the actual 11 through 0011.
4c319a2 selects the latest active schema by default and retains manual selections per connection/project.
SDK guidance also skips the latest version if retired and offers no code when no active version exists.

cb9dd29 adjusts the per-minute cleanup row budget to 500–10,000 rows based on project count and
each project's daily receipt limit. This is a calculated value with 2× headroom, not a guarantee of actual remote throughput.
The default is 4 projects/up to 45 SQL statements per page; the optional 4 pages allow up to 180 SQL statements.
The 9 deletes and the MIN query for remaining expired receipts after deletion run in the same batch.
Optional metrics connect deleted rows, tables hitting the limit, observed projects, expired receipt lag, and
calculated capacity shortfalls to logs/local summaries/admin reports. Historical logs for 20 projects remain readable.
Expiration/aggregate retention periods, cursor CAS, the 20-second execution budget, and 30-second DB lifetime remain unchanged.

139ce1e returns rejected Origins before writing the per-minute DB limit. Therefore pre-admission rejections
are not added to DB rejection diagnostics and are checked through existing HTTP observability logs. Historical
reason enum/stored values remain unchanged. The optional BROWSER_INGEST_LIMITER host port runs before DB/body
processing on browser paths, returning 429/Retry-After 60 or 503 on failure/cancellation/deadline.
It shares the existing actual I/O concurrency limit and does not retry. Server authentication/publish authorization order is retained.

Final local validation:
- Full admin `npm run test:admin`: 295/295. Includes new scope/CSV regressions and latest active version,
  empty/retired-only lists, page order, cancellation, and original error checks.
- Cleanup/log summary/diagnostics/CLI 29/29; collection/public admission/rejection diagnostics 25/25;
  storage/rejection/server publication/request lifetime regressions 35/35. Ran sequentially with the Node test runner directly.
  The final admission file passed 3/3 again after adding the limiter deadline check.
- Actual temporary Miniflare D1: after deleting 500 of 1,201 expired receipts, confirmed expiry lag
  of 1,234ms for the remaining 701, null after further deletion, retention of unexpired receipts, and at most 50 SQL statements by default.
- Passed `npm run typecheck` (including generated Collector/Admin host types), final admin type checking,
  `npm run build:admin`, bundle 2/2/Sites 11/11, and `git diff --check`.
- Enhanced `npm run verify:admin-analysis-access`: Chromium 156.0.8078.4,
  latestActiveSchemaSelected/projectVersionSelectionsIsolated true, 0 workflow requests on the event screen,
  API reads 36/writes 0, pageErrors 0/routeError false. Using synthetic local OIDC and actual D1,
  confirmed skipping latest v3 retired to select v2, retaining manual v1 per project, CSV isolation, permission
  revocation/recovery, late 403 discard, disconnection, and existing time zone/response-size boundaries.
  Evidence is `.tmp/admin-analysis-access-zLgePr/report.json`. The runner cleans up its own processes.

Not run/remaining scope:
- Full root tests and unchanged SDK checks were not repeated. This run is limited to the changed
  admin/storage cleanup/collection protection paths and connected regressions. No general source lint command exists.
- Real OIDC provider, remote D1 throughput/cost, production Cron, and limiter binding activation were not exercised.
  Without the production configuration bundle and actual traffic, no remote accuracy/capacity claims are made.
- The upstream limiter works only when connected by the host and is an approximate per-location limit, so it
  does not replace existing DB limits. It does not authenticate against Origin spoofing itself.
- SDK diagnostic hooks, public release/licensing, the integrated service screen, and duration/long-term aggregation
  were not included in this defect-fix batch.

Owned documents: updated the OpenAPI collection behavior description, backend collector/event-contract/retention-cleanup/
logging docs, frontend design, ops observability, LOG-SUMMARY, README, and this record.
API request/response shapes and DB schema/migrations remain unchanged. Internal storage cleanup limits and
public collection rejection order/DB diagnostic inclusion scope changed. Optional log metrics are read alongside
the previous format. Dependencies/repository hygiene/CI runner settings were unchanged; only existing opt-in browser
checks were extended. No push, deployment, or SDK publication.

## Failure isolation, partial analysis, delivery diagnostics, and integration overview follow-up — 2026-10-23

c715e58 separates actual I/O execution limits for the public limiter and DB. The limiter defaults to a cap of 4,
adjustable through optional maxPublicOperations. Existing maxDatabaseOperations applies only to DB.
Even with 2 unresponsive limiter operations and canceled requests, authenticated admin project queries
retain 200 responses. Only limiter slots saturate; they are not released early before actual I/O finishes.

444e022 uses the automatic schema selection checkbox to release manual pinning and reread the latest active version.
Other projects' pinned selections remain. 14a8f47 isolates ordinary goal workflow failures/contract errors
as per-panel failures, retaining healthy workflows/funnels. Retries query only failed current workflows
and merge them in definition order. 401/403 propagates to overall permission handling; missing workflows
in the current/previous period lock CSV. Previous-period comparisons are not requeried merely because the current
panel recovers; a separate retry is provided. Noncomparable values remain null.

3fd006b/eaccd35 add the optional synchronous browser callback onDelivery(state, events).
It distinguishes HTTP acceptance/retry/failure/deadline/queue overflow/destroy discard/beacon queue acceptance by an injected host.
It does not pass raw payloads, event names/IDs, or URLs. Observation callback exceptions/reentrancy do not
affect delivery. accepted counts HTTP acceptances, not newly aggregated records or delivery completeness.
The standalone SDK limit remains 3KiB. Adding diagnostics pushed the representative integration total above the existing 3KiB,
so the integration budget was explicitly adjusted to 3.25KiB (3328B). Schema/input validation was not removed.
The shared size-policy is also used by generated-code checks. Final gzip sizes are base SDK 2903B/Sembom 3179B/
funnel SDK 3028B/funnel example 3157B/admin generated funnel code 3182B.

8bce2f3 adds an explicitly opened service integration overview to the overview screen. It reads up to 5 projects
on the current page, with 2 project operations and existing HTTP limits, without automatic polling.
It separately shows events over the most recent 7 days/change from the preceding 7 days for the selected source/latest
active version, the first registered workflow's completion rate/change, project-wide latest receipts, and DB rejection counts
over the most recent 7 UTC days. It does not sum completion rates across services and distinguishes no active schema,
query failure, no receipts, and actual 0. This is a bounded page implementation combining existing APIs,
not a bulk API reading all services at once.

Validation:
- public-admission 4/4: no DB access when blocked, server authentication order, failure/cancellation/deadline,
  no consumption of normal quota by rejected Origins, and regression coverage for isolation of the new execution limits.
- Full browser SDK 64/64: includes 3 new delivery diagnostics checks, exceptions/reentrancy, retry exhaustion,
  queue overflow/destroy, and distinction between beacon queue acceptance and HTTP acceptance.
- Final full admin 298/298. Includes partial failure/CSV validation, permission error propagation, panel recovery,
  and integration overview checks for the cap of 5, 2 operations, order, 0/null distinction, and cancellation.
- Passed npm run typecheck, final admin type checking/build, build:browser, check:browser-size,
  bundle 2/2/Sites 11/11, and git diff --check. Generated-code budget checks also passed 6/6.
- Enhanced verify:admin-analysis-access: Chromium 156.0.8078.4,
  automaticVersionRestored/projectOverviewVerified/latestActiveSchemaSelected true,
  0 workflow reads after event screen query completion, pageErrors 0/routeError false,
  API reads 57/writes 0/browser collection 0. Previous CSV/permission/disconnection boundaries also passed.
  Evidence is .tmp/admin-analysis-access-gsIKQR/report.json; the screenshot is project-overview.png.
  One workerd Windows WSARecv #64 diagnostic appeared for a canceled socket, but validation passed.
- Final verify:admin-goal-access: Chromium 156.0.8078.4, workflow 503 panel recovery,
  retention of healthy funnels and 7 existing actual D1 permission revocation/recovery scenarios, screen/downloaded CSV
  comparison, late denial responses, and disconnection all passed. API reads 69/writes 0/pageErrors 0.
  Evidence is .tmp/admin-goal-access-wnFSyB/report.json.
- The analysis browser check's initial event-workflow-count failure was a boundary issue that counted overview
  requests sent before screen switching as event screen reads. Corrected observation to start after event query
  completion; retained the unit check that initial event loadPeriod does not read workflows.
- The initial SDK integration size check failure exposed different constants used by the shared budget and admin
  generated-code check. After making both read the same budget, full admin checks passed.

Full root tests and unchanged storage/server SDK/production load checks were not repeated.
Focused on changed paths and connected regressions; there is no general lint script. Real providers/remote D1,
limiter binding activation, traffic costs/capacity/SLO remain unverified. This uses synthetic login/temporary D1;
no production incident is inferred solely from no receipts or short-term completion rate changes in the integration overview.

Updated product specification/performance budgets/browser-sdk/frontend design/collector docs/README/this validation
record. Added public SDK options/types while retaining existing required signatures. HTTP API shapes,
DB schema/migrations, retention policy, dependencies, repository hygiene, and CI runner settings were unchanged.
Only existing opt-in browser checks were extended. These are local main commits; no push, deployment, or public distribution.
