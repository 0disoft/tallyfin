# Validation History 15

This historical record preserves the section order of the original. Commands and code paths are relative to the repository root.

## 2026-10-10 Rejection reason collection and admin query integration

Connected GET /v1/projects/{projectId}/collection/rejections?from={UTC-date}&to={UTC-date}.
reader/owner can also query projects without a schema or with collection stopped; from/to are required
and must fall within the most recent 7 UTC dates, including today. meta returns UTC/receivedAt/retentionDays=7/coverage=
best-effort, an overall summary, days for every date, and a fixed set of 10 reason/count/lastRejectedAt
buckets. When the recorded count is 0, the timestamp is null; date, permission, and corrupted-storage failures
are not filled in as 0. Per-minute/daily quota_exceeded is distinguished as minute_limit/daily_limit.

The actual collector additionally records only rejections occurring after admission passes; per-minute excess
is already recorded by the existing admission SQL. Unknown projects, admin failures, and admission DB
failures are excluded. Diagnostic persistence is attached to Worker ctx.waitUntil; hosts without that port
await it. Persistence failures do not change the original response or produce retries/raw-payload logs.
No diagnostic writes or DB round trips are added for successful requests. The existing behavior that lowered
the counter for the same minute to limit+1 was supplemented with saturation at 601, so lowering and then raising
the setting no longer decreases the counter, and accepted/additionally recorded requests remain capped at 600.
Raw payloads, Origin, IP, tokens, and requestId are absent from the diagnostic DB/responses. Post-response recording,
diagnostic storage failures, and the absence of historical backfill can cause omissions, so these records are not
used as a complete rejection rate or proof of delivery. Prototype UI integration is the next slice.

Passed root npm test 171/171, npm run typecheck (including generated Worker types), OpenAPI parsing with Bun.YAML,
checks of the new path and response example buckets/totals, and git diff --check. The 4 new HTTP tests
cover actual rejected requests, per-minute/daily distinctions, Retry-After, absence of raw payloads in responses/DB,
reader/owner, unauthenticated/other-project/missing-project/date/duplicate-parameter/method cases, permission revocation,
nonblocking responses with a slow sink, ignored failures/no retries, native Worker execution context, and actual D1
record/query smoke checks. The first esbuild run for the native smoke failed because a JSON return in a test string
was missing a bracket; after fixing it, 4/4 and the final 171/171 passed. Storage tests gained checks that
counters do not decrease after setting changes and that counts/final timestamps survive 12 concurrent records.
Total validation took about 59.5 seconds; the unchanged admin build/browser UI checks were not repeated.

Updated OpenAPI/examples, DBML, the product specification (source of truth), admin/logging/collection/migration docs,
the roadmap and screen docs' statements that the API was unsupported, and this record. The initial DB change was
the 0004 additive column extension; it was not applied remotely. Extended core storage/admin ports and Worker
context forwarding. No SDK, dependency, hygiene policy, CI, runner, or validation command changes. Skipped lint
because no command exists. Production load/real authentication provider/remote DB/deployment/UI integration remain
unverified or follow-up work. Each test cleaned up its temporary unit-test Miniflare and development servers.
No push, deployment, or Sembom integration.

## 2026-10-10 Admin collection rejection summary UI

Connected CollectionRejections to CollectionDiagnostics in API-connected mode settings.
It shows project-wide recorded rejection counts and the last rejection timestamp for the most recent 7 UTC dates;
the fixed 10-reason table and daily table in newest-first order are collapsed in details. Diagnostics do not add
raw payloads, Origin, IP, or tokens, and explain the UTC receipt date, best-effort omissions, and absence of historical
backfill. No rejection rate or remaining quota is inferred. Settings, schema, and rejection queries run in parallel;
the receipt summary is read only when a schema exists. Each failure is displayed independently,
without replacing it with 0 or no records. Existing cancellation/client/project keys and manual refresh
behavior are retained; no additional polling or test events are sent.

The first admin npm test run passed 82 existing/relevant tests; 9 failed because the new tests' relative path
to the official JSON example incorrectly climbed one directory too far. After fixing the path, the relevant
10/10, final full 91/91, and npm run typecheck passed. Checks covered dates/reasons/totals/duplicates/safe integers/
UTC timestamps, 0/null, 7 dates, project/period matching, partial failure, stopped/unknown-schema states, and cancellation.
Passed npm run build and npm run test:sites 4/4. The existing main JS chunk warning above 500kB remains;
this work did not change dependencies or bundle configuration.

Verified actual admin reader queries using the existing local Vite 5180 and a separate in-memory Miniflare D1 5188.
Confirmed origin_denied 1/invalid_event 2, the fixed 10 reasons and 7-day table, distinction between UTC dates
and today in Seoul, retention of other diagnostic values on 503 without displaying 0, requery after recovery,
and actual 0/null displays. At 360px, only the table region scrolled with no page overflow; text was 16px.
There were no browser console errors. Restored the test viewport changes and cleaned up Miniflare.
Reviewed and incorporated documentation/layout suggestions from the designated CommandCode DeepSeek 4.1 Flash high.

Updated FRONTEND_DESIGN.md (screen source of truth), the prototype README, product roadmap, and this record.
No API/DB contract, SDK, dependency, hygiene policy, or CI/runner changes. The backend was unchanged,
so the preceding commit's 171/171 validation results were reused. Skipped lint because no command exists.
Real production authentication/remote DB/production load/deployment remain unverified; no push, deployment,
or Sembom integration was performed.

## 2026-10-10 Custom query period selection

Added custom selection and DateRangePicker to the query period in the API connection. Aligned project-local today,
the most recent 90-day retention window, and the inclusive 31-day limit with existing server rules. While editing,
existing results and CSV remain with an unapplied-changes notice; queries run only on apply. Empty values, invalid dates,
reversed/future ranges, and retention/period limit violations are rejected. Applied values are reflected together
in overview/event/goal/property-detail/comparison/CSV query keys. Project/time-zone/default-period/reconnection changes
reset the range; view/version changes retain the applied period. Previous-period comparisons outside retention are
blocked before a request while retaining current results; turning comparison off allows the current CSV.
Historical periods do not show the notice that today's aggregation is in progress. Sample/settings collection diagnostic
scopes are retained. No date persistence, new dependencies, or automatic polling.

Passed admin npm test 94/94, npm run typecheck, npm run build, npm run test:sites 4/4,
and git diff --check. The 3 new date tests cover boundary agreement with actual core.queryDates,
exact 31-day/90-day boundaries, future/reversed/empty/invalid dates, leap years/year-end/DST,
project-local today, and previous comparison period retention boundaries. Backend code was unchanged,
so the prior 171/171 results were reused. The existing JS build warning above 500kB remains;
bundle splitting was not performed in this slice. Skipped lint because no command is registered.

Verified reader queries using local Vite 5180 and isolated in-memory Miniflare D1 5188.
Applying October 9 alone changed the total from 75→62; checked its daily chart, comparison with October 8,
events/goals/property completion rates, and current/previous from/to and 62 records in the actual CSV file.
Existing results remained while editing; verified the error for more than 31 days and comparison blocking/current
result retention at the 90-day boundary. Browser automation initially changed date values only in the DOM without
triggering onChange; after switching date fields to onInput handling, confirmed the draft notice/apply behavior.
Checked return to the default 7 days, reset on selecting custom again, no page overflow at 360px, and 16px date inputs.
There were no browser console errors. Restored the validation viewport and stopped the development/Miniflare servers started.
Reviewed and incorporated labels/minimal form design/documentation drafts from the designated CommandCode DeepSeek 4.1 Flash high.
The first draft was truncated by the token limit; increased the same model's budget and obtained a complete result.

Updated product specification 02-spec.md, screen source of truth FRONTEND_DESIGN.md, the prototype README,
roadmap, and this record. No API/DB, SDK, dependency, hygiene policy, or CI/runner changes.
Real production authentication/remote DB/production load/deployment remain unverified. No push, deployment, or Sembom integration.

## 2026-10-10 Previous-period comparison by workflow property

Connected comparison with the immediately preceding period of equal length to goal completion rates by registered property.
The existing breakdown API is queried additionally only when comparison is enabled; values observed in the current and
previous periods are merged by data type, showing starts/successes/completion rates in current/previous order.
Completion rate changes use %p. Unobserved values have count 0; periods with 0 starts have null/— completion rates
and differences. Current/previous queries and retries are separate; responses to canceled requests are discarded.
A comparison query failure retains the current table. CSV adds previous property totals/daily details and
workflow_property_comparison rows, with the metric column distinguishing starts/successes/completion rate.
An incomplete/failed active comparison locks export; disabling comparison allows current CSV.
Event property comparison and previous daily views by value are outside this scope.

Passed admin npm test 97/97, npm run typecheck, npm run build, npm run test:sites 4/4,
and git diff --check. The 3 new tests cover weighted completion rates and %p, false/numeric 0 keys,
the union of values across both periods, empty results, 0 starts, aggregation-in-progress states, rejection of
other projects/versions/time zones/groupings/periods, previous daily CSV by value, values absent from the current period,
incalculable changes, and rejection of missing comparisons. Skipped lint because no command is registered.
Backend/API/DB were unchanged, so backend tests were not repeated. The existing JS build warning above 500kB remains.

Verified reader queries in the browser using local Vite 5180 and isolated in-memory Miniflare D1 5188.
Confirmed tool=loan starts 20/10, successes 16/6, completion rates 80%/60%, +20%p, and grade/timer
with previous count 0 and incalculable completion rates. Failed only the previous breakdown with 503 and checked
retention of the current property table, CSV locking, export availability after disabling comparison, and recovery
by comparison retry. Checked the 9 comparison rows, previous data, metric, and units in the actual downloaded CSV.
For current October 4–5 with 0 records/previous October 2–3 with 10, the previous-only loan value remained as
0/10, 0/6, —/60%. A requested mobile viewport of 360 was actually applied as 400px in this environment;
confirmed page width 383px and scrolling within the table. 360px itself remains unverified. There were no console errors.
Saved the comparison table screenshot to .tmp/prototype-qa/workflow-property-comparison.jpg and closed validation servers/tabs.

Delegated documentation updates to CommandCode DeepSeek 4.1 Flash high and compared the result with the code.
Updated product specification 02-spec.md, screen source of truth FRONTEND_DESIGN.md, the prototype README,
roadmap, and this record. No API/DB, SDK, dependency, hygiene policy, or CI/runner changes.
Real production authentication/remote DB/production load/deployment remain unverified; no push, deployment, or Sembom integration.

## 2026-10-10 Previous-period comparison by event property

When event analysis is grouped by a registered property and previous-period comparison is enabled, the existing event
daily API queries the immediately preceding period of equal length for the same event/property/project/schema/time zone.
useEventPropertyComparison handles previous-query state/retries/cancellation; a separate
EventPropertyComparison table shows current/previous counts, percentage change (%), share, and share change (%p).
The share denominator is the total count of the selected event in each period. Values retain their data types as
the union of observed values across both periods is compared. Missing values have count 0 and share 0 when total
events exist; when the total is 0, shares and differences are null/—. Percentage change from a previous count of 0
is also null/—. Details without grouping do not request previous properties. On failure, the current table and chart
remain and only previous properties are requeried. Condition changes, disabling comparison, and unmounting cancel
requests and discard late responses. An incomplete/errored active grouped comparison locks CSV. Disabling comparison
allows current-period CSV; disabling grouping allows CSV retaining the overall event period comparison.
CSV contains previous detail totals, daily rows, property-value rows, and property_comparison rows.
It preserves metric=count/share, change units percent/percentage_point, value data types, and incalculable values.

Passed admin npm test 101/101, npm run typecheck, npm run build, npm run test:sites 4/4,
and git diff --check. The 4 new tests cover count change versus share difference, new/disappeared/null/false/numeric 0
values, empty periods/0 denominators, rejection of invalid metadata/dates/groupings/totals,
actual ApiClient forwarding of existing query paths/groups/periods/signals and rejection of cancellation/late responses,
previous daily CSV, share changes, incalculable values, and rejection of missing/invalid previous data.
Skipped lint because no command is registered; unchanged backend code was not revalidated.
The existing JS build warning above 500kB remains. LiveDashboard.tsx is 41.7kB and a candidate for later splitting.
The previous-query state and comparison table for this slice were placed in separate files.

Verified using reader data from local Vite 5180 and isolated in-memory Miniflare D1 5188.
Confirmed tool_view loan 12/10, +20%, shares 44.4%/66.7%, -22.2%p; grade 10/5, +100%;
and timer 5/0, incalculable percentage change, shares 18.5%/0%. The 6 comparison rows and previous daily rows
by value, numbers, and units in the actual downloaded CSV matched the screen. Failed only the previous grouped
time series with 503; confirmed retention of the current table's 27 records/chart, CSV locking, unlocking when
comparison/grouping was disabled, and recovery through a separate retry. In the custom October 4–5 period with
current count 0/previous October 2–3, previous loan/grade remained, showing -100% and current share/difference —.
At an actual CSS width of 320px accounting for browser zoom, the page was 303px and the table 221px/content 575px;
only the table scrolled, with no page overflow. There were no console errors.
Saved the screenshot to .tmp/prototype-qa/event-property-comparison.jpg, restored the viewport, and closed validation
tabs/servers. Browser zoom itself was not changed.

Compared CommandCode DeepSeek 4.1 Flash high's documentation updates with the code. Updated product specification 02-spec.md,
screen source of truth FRONTEND_DESIGN.md, the prototype README, roadmap, and this record.
No API/DB, SDK, dependency, hygiene policy, or CI/runner changes. Production authentication/remote DB/production load/deployment
remain unverified; no push, deployment, or Sembom integration.

## 2026-10-11 Admin chart lazy loading

Changed the overview's daily trend chart in `Trend` in `Dashboard.tsx` to lazy-load through
`import('./TrendChart')` in `useEffect`, and moved the Recharts JSX to `TrendChart.tsx`.
The loading placeholder announces itself with `role="status"`; a failure retains the daily numeric table
and the rest of the screen, with a `Refresh page` button to recover in a new document. Late import results
after unmounting are discarded. No API/DB, SDK, dependency, CI, or hygiene policy changes.

In `prototypes/admin`, passed npm test 101/101, npm run typecheck, npm run build,
npm run test:sites 4/4, and `git diff --check`. The existing JS warning above 500kB disappeared
from the build. Root `npm run check` and contract checks were not run in this slice.

Bundle: initial JS in baseline commit `53aa645` decreased from 800.26kB/gzip 228.43kB to 446.61kB/gzip
125.83kB, about 44.9%; the chart chunk is 353.93kB/gzip 102.84kB. The overview has a chart on its default screen,
so its total JS gzip is nearly unchanged, from 228.43kB to 228.67kB, and requests increase from 1
to 2. This does not mean total size/load time decreased for every screen.

Browser verification used local `vite preview` (127.0.0.1:5180, production build) and Codex's in-app
Chromium with cache disabled, running 3 baseline trials followed by 3 lazy-loading trials consecutively in the same tab.
There was no CPU/network throttling. FCP changed from 452/376/296ms to 308/252/296ms, with the median
from 376ms to 296ms; DCL changed from 351.5/266.3/216.5ms to 179.4/175.6/168.8ms, with the median
from 266.3ms to 175.6ms. Overview main fetch completion was 302/213.4/139.1ms at baseline and
77.3/93.3/88.4ms with lazy loading; chart chunk fetch completion was 378/541.2/433ms. The `load` event
is not the asynchronous chart completion time. Resource Timing encodedBody was 226491 bytes at baseline;
the lazy-loaded entry's 124796 bytes plus chart's 101925 bytes totaled 226721 bytes. Local preview
server compression differs from Vite build gzip, so these values are not interchangeable. The sample has 3 trials,
measured sequentially with warmup mixed in, and does not guarantee improvement; production CWV/INP/LCP/full traces were not measured.
Warmup is mixed in and improvement is not guaranteed; production CWV/INP/LCP/full traces were not measured.
Raw measurements are in the locally ignored file `.tmp/prototype-qa/chart-load-metrics.json`.

The daily numeric table and summary metrics remained when the chart chunk was blocked. After directly confirming
that the browser remembers a failed import for the document and another load attempt does not recover it,
removed the network block and confirmed chart recovery with the `Refresh page` button.
The failure placeholder's desktop height was 280px. On the actual `/auth/callback` screen without a chart,
only the entry's 124796 bytes and OidcLogin's 10773 bytes were requested; the chart chunk was not fetched
(no authentication values were entered).

Changed the period from 7 to 14 days and confirmed the chart total updated to 43440 and the event detail
`conversion_started` total to 8825. At an actual CSS width of 320px (innerWidth 320; viewport 288 reflects existing 90%
zoom, which was not changed), both normal and chart-download-blocked failure screens had a 303px page,
285px chart placeholder height, and no horizontal overflow. Reconfirmed `role=status` and refresh recovery
on the failure screen. The final full-screen capture is
`.tmp/prototype-qa/chart-lazy-load.png`. Restored browser cache/blocked URL/viewport settings,
closed the validation tab, and confirmed no 5180 listener after stopping the local validation server.

Production authentication, real DB, actual server load, Sembom integration, remote push, and deployment were not performed.

## 2026-10-11 Admin font loading cleanup

Changed the admin prototype's fonts from 9 weight-specific static CSS files to 2 variable font CSS files
(`@fontsource-variable/inter/wght.css`, `@fontsource-variable/noto-sans-kr/wght.css`).
Reduced the 9 import lines in `App.tsx` to 2, removed static dependencies `@fontsource/inter` and
`@fontsource/noto-sans-kr`, and added `@fontsource-variable/inter` and
`@fontsource-variable/noto-sans-kr` at `^5` (installed 5.3.0). Connected the `scripts/font-assets.mjs`
plugin in `vite.config.mjs` to alias only the family and weights of the actual packages' `@font-face` rules.
Inter uses `400 800` (CSS 900 maps to 800); Noto Sans KR uses `400 500`, `700`, and `900`
(600 and 800 map to 700 and 900); original `unicode-range` and subsets remain unchanged. The plugin
bundles the two original OFL texts as `dist/client/fonts/inter-OFL.txt` and `noto-sans-kr-OFL.txt`.

Added `tests/font-assets.test.mjs` to the test runner to check retention of all actual package unicode ranges
and original src, no increase in duplicate file downloads per subset, compatibility with existing weights,
detection of original changes, and license inclusion. In `prototypes/admin`, passed npm test 105/105, npm run typecheck,
npm run build, and npm run test:sites 4/4. Build CSS decreased from 380.42kB/gzip
119.38kB to 264.85kB/gzip 35.91kB; initial JS remained 446.61kB/gzip 125.83kB.
Skipped lint because no command is registered; the unchanged backend was not retested.

Browser verification used local `vite preview` (127.0.0.1:5180, production build) and Codex's in-app
Chromium with cache disabled, comparing baseline and variable fonts once each in the same tab.
Inspected Resource Timing after waiting for `document.fonts.ready`. Actual preview-served
encoded CSS decreased from 113783 to 33732 bytes. Initial-screen fonts decreased from 28 requests/324224 bytes
to 9 requests/178064 bytes, and combined CSS/font bodies from 438007 to 211796 bytes. Headers were
excluded; preview server compression and Vite build gzip are not interchangeable. Confirmed matching
before/after geometry of overview headings/metrics/tables; exhaustive glyph verification was not performed.

Using `document.fonts.load`, confirmed actual loading of 4 Greek/Cyrillic/Latin subset faces for Inter 600
and 6 Hangul/Hanja subset faces for Noto Sans KR 700. This checked downloading of supported subsets,
not every glyph. Font CSS requests on local dev (5181) showed the aliased Inter and weight range
`400 800`; confirmed the 2 original OFL texts were actually bundled in `dist/client/fonts`.
The event analysis detail chart for `conversion_started` remained at 4800 records.

At an actual CSS width of 320px (innerWidth 320; viewport 288 reflects existing 90% zoom, which was
not changed), normal and all-WOFF2-blocked failure screens both had a 303px page without horizontal overflow.
Despite 379 face errors on the blocked screen, metrics 24680/4800/4128/86.0% and
tables/charts/menus remained readable. Removed the block, restored cache/viewport settings, closed the validation tab,
stopped validation servers, and confirmed no 5180/5181 listeners. Raw measurements are in `.tmp/prototype-qa/font-load-metrics.json`;
screenshots are `font-before.png` and `font-after.png`. Exhaustive checks of other screens, production CWV,
and older-browser tests were not run.

No changes to API/DB, SDK, dependency hygiene policy, CI runners, or production authentication; only frontend dependencies,
the Vite plugin, and test command changed. No push, deployment, or Sembom integration. The Fontsource variable font
reference is the [Fontsource variable font guide](https://fontsource.org/docs/getting-started/variable).

## Project owner-only grant list — 2026-10-11

Added `GET /v1/projects/{projectId}/grants` and `AdminStore.grants`. Permissions and the list are
read in the same D1 batch, paginated in issuer/subject composite primary key order. limit defaults to
25 with a maximum of 100; cursors are project-specific positions, and owner permission is rechecked on every page.
Responses return only the initial creation timestamp, registered identifiers, and role, retaining no-store.

Root `npm run check` passed type checking, 177/177 tests, and SDK size checks.
SDK gzip 2667 bytes and SDK+Sembom gzip 2949 bytes remained unchanged. Subsequently expanded the cursor limit
to 12288 characters (query 12352 characters) and added an actual cursor round trip to the Worker smoke test.
After those changes, passed `npm run typecheck`, the 13/13 existing admin tests (including Worker smoke), and final
`node --test --test-timeout=30000 apps/collector/test/grants.test.ts` 6/6.
After the final limit/smoke changes, rechecked the relevant scope rather than repeating all 177 tests.

Additional tests check exclusion of other projects' identifiers, blocking readers/external owners/issuer changes,
queries past deleted cursor positions, role downgrade between pages and revocation immediately before batch execution,
cursors with long Unicode/quoted identifiers, invalid/other-project cursors, parameter/authentication/storage errors,
and private exceptions. Also checked the owner list and cursor round trip in Miniflare workerd. Tests injected
a trusted verifier; real-provider login/production tokens/remote DB were not exercised because no integration environment exists.

Passed `npm run lint` (OpenAPI) and `npm run check` 36/36 in `tools/contracts`, and `git diff --check`.
Updated API/product specification/roadmap/admin boundary docs and validation records; added the new response example,
closed-shape checks, and page-limit checks to contract validation. Skipped general source lint because no command exists.
No DB, migration, SDK, dependency, CI runner, hygiene policy changes, production deployment, push, or Sembom integration.
Each page reads the current DB, so grants newly added before the current position require querying again from the start.
Permission management UI and grant assignment/change/revocation APIs are follow-up work; the existing CLI remains.

## Admin grant list UI integration — 2026-10-11

Connected owner-only `LiveGrants` in the API mode settings screen. `ApiClient.listGrants` reuses
existing bearer/same-origin/no-store/no-referrer/credentials omit policies and validates the closed
response shape, roles, identifier lengths, registration timestamps, project, page limits, and nonadvancing cursors.
`GrantList` retains only one current 25-record page and clears rows on failure/new queries/dispose.
Old settings snapshots after project/connection changes are also excluded from rendering so existing owner state
is not applied to a reader. Each response checks both abort and generation number.

In `prototypes/admin`, passed `npm test` 111/111 (including 6 new grant list tests), `npm run typecheck`,
`npm run build`, `npm run test:sites` 4/4, and `git diff --check`. Tests check
row removal after permission revocation/network errors, retry of failed pages, cursor advancement/refresh, duplicate clicks,
late-response/unmount disposal, and response contract errors. Skipped general lint because no command exists;
the unchanged backend's root checks and remote migrations were not repeated.

Used a credential-free validation page injecting a synthetic transport into the actual `LiveSettings`/`LiveGrants`
components in Codex's in-app Chromium and local Vite (127.0.0.1:5182). Verified owner pagination from 25→2 records,
disabled end button, retention of 2 requests/removal of the table after switching to reader, table removal after
a next-page 403, empty-page notice, and display of only the other project's data. There were no console errors.
At actual CSS innerWidth 320px (viewport 288px with existing 90% zoom), page scrollWidth was
303px and the table 540px/scroll region 255px, without overall page overflow. The 508-character identifiers were
not truncated; cells were 18px. Confirmed internal ArrowRight scrolling after focusing the table region with Tab.
Restored the viewport and closed validation tabs/servers. Screenshots are `.tmp/grants-ui-qa/owner.png` and
`mobile.png`; the temporary validation page is also kept only in ignored `.tmp`.

Updated the product specification, roadmap, frontend design, and validation records. No API/DB/SDK/dependency/CI runner/
hygiene policy changes, push, deployment, or Sembom integration. Production OIDC/real-account integration was
not run because no environment is connected. This screen is read-only; permission changes use the existing CLI.

## Admin change history UI integration — 2026-10-11

Connected owner-only `LiveAdminChanges` below the grant list in API connection settings. It validates the closed response
shape, project, 90-day window, record ordering, page limits, and cursor advancement, retaining only one current
25-record page. New queries/failures/loss of permission clear records; abort and generation numbers block late
responses. Once settings/permission persistence is confirmed, the first page is reread.

Ran and passed `npm run typecheck`, `npm test` 123/123 (including 5 new change history tests),
`npm run build`, and `npm run test:sites` 4/4 in `prototypes/admin`. New tests check response validation,
transport policies, failed-page retry, duplicate clicks, last page, 401/403 record removal, request cancellation,
late responses, and dispose. API/DB/SDK were unchanged, so backend checks were not repeated;
general source lint was skipped because no command exists. Production OIDC/remote D1 integration was not run either.

Used a credential-free page injecting a synthetic transport into the actual `LiveSettings`/`LiveGrants`/
`LiveAdminChanges` in Codex's in-app Chromium and local Vite (127.0.0.1:5183). Verified pagination from 25→3 records
and last-button locking, retry of the same page after a network error, no additional history requests when switching
to reader, table removal/parent locking after next-page 403, empty history, discarding late responses after project
switches, and new records after settings/permission saves. Rows clear and buttons lock while loading;
there is no automatic polling. HMR from changing the temporary validation page title produced one duplicate createRoot
warning; no new errors occurred after reopening the page. The validation page exists only in ignored
`.tmp` and is not a production app change.

At actual innerWidth 320px with existing browser zoom at 90%, document scrollWidth was 303px,
the table 540px/scroll region 255px, with no document overflow. The 508-character identifiers were not truncated;
cell details and table headings were 18px. Confirmed internal ArrowRight scrolling after focusing the table region with Tab.
Screenshots are stored at `.tmp/admin-changes-ui-qa/desktop.png` and `mobile.png`; restored the viewport.

Updated product specification/roadmap/admin boundary/frontend design/prototype guide and validation records.
No API/DB/SDK/dependency/CI runner/hygiene policy changes, push, deployment, or Sembom activation.
