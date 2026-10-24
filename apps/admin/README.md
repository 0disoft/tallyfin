# Tallyfin Administrator App

The current administrator UI uses Korean. UI labels in this guide are described in English.

The optional funnel definitions in the JSON schema editor in settings are preserved when validating,
publishing, and re-reading them. The publication hash and lost-response checks include funnels, and
form changes that affect linked events and classifications are locked. The funnel-specific stage
editing form, stage analysis screen, and CSV are connected locally.

This administrator app is based on the selected
[overview visual concept](../../docs/frontend/SELECTED_VISUAL.md). ModuFile, Sembom, and Orchid Pass
use virtual data and do not query real services. The default address and `/auth/callback` start in
**API connection** mode (same-origin `/v1` administrator API reads and setting saves). Only
`/demo` or `/demo/` offers the **Sample** and **API connection** mode switch. A query on the
normal address does not enable the demo. API mode provides OIDC sign-in and direct administrator
bearer connection. Real authentication-provider configuration and production deployment are not
connected yet.

Administrator API requests have a default 15-second limit from waiting for token refresh through
reading the response body. When the limit is reached, loading ends and the UI shows a retryable
error. Cancelling a call or disconnecting ends an in-flight wait and discards a late response.
Cancelling one request does not cancel a shared sign-in refresh. A 401 or 403 already received
remains a permission error even if its error body stalls. If a save result cannot be confirmed, the
UI does not resend automatically; it preserves the input and explains that the latest server state
must be checked. The internal `ApiClient` constructor option `requestTimeoutMs` can adjust the
limit from 10 to 120000 milliseconds.

After connecting, expanding `Account identity` reads the server-verified issuer and subject with
`GET /v1/identity`. A first account without project permission can use it, and no query is made
while it remains collapsed. Read-only fields and a JSON copy are provided; if copying fails, the user
can select the JSON directly. On failure, it clears the previous identity and offers retry.
Closing, replacing the connection, or disconnecting cancels the request and discards late responses.
It does not copy tokens or roles, or grant permissions.

In the settings screen, expanding **Storage Read Check** and then pressing the button manually calls
`GET /v1/health` and verifies only reads of the 2 administrator control-plane tables. Expanding the
panel alone makes no request, and there is no automatic polling, JSON display, or identifier display.
On success, it shows the time of this check, which is not a metric-refresh time. On failure, it shows
only an error message and leaves no success indicator. Closing, replacing the connection, or
disconnecting cancels the request and discards late responses. Requests are cancelled after 5
seconds and can be retried manually. Collection storage and cleanup work must be checked separately.
The screen was verified with Chrome, ephemeral signed OIDC, and local D1, and results are in the
[validation record](../../VALIDATION.md). A real OIDC provider is not connected yet.

Under **Operational Log Report** in settings, select a `logs:summary` v2 JSON file to read observation
counts, weighted request estimates, error and review items, HTTP responses and latency buckets, and
retention-cleanup processed counts in a table. The file, limited to 8 MiB, is validated in the
Worker and is not sent to a server or stored. Long response tables paginate at 25 lines, and missing
cleanup details show the processed count as `—`. This report covers the entire collector and is
separate from project and period selection; closing it, selecting a new file, or replacing or
disconnecting the connection clears the read and its result. Usage is in the
[local report guide](../../docs/ops/local-report-viewer.md).

The deployment Worker forwards `/v1` and `/v1/*` to the collector through the fixed `COLLECTOR`
service binding. A missing binding or failure returns a 503 JSON response instead of the app HTML.
The actual target file is prepared with root `npm run admin:config`. Build, same-origin production
configuration, and rollback follow
[administrator Worker deployment preparation](../../docs/backend/runtime.md#administrator-worker-deployment-preparation).
The default Sites packaging has no collector binding and therefore does not provide a production API
connection.

To prepare production sign-in values as well, create the configuration bundle with root
`install:prepare`, then build with
`admin:build-configured -- --dir <installation-directory>`. It does not mix existing `.env` or
`VITE_` values and uses only public sign-in configuration; output goes to that bundle's
`admin-assets`. Follow the [production installation guide](../../docs/backend/installation.md).

## Running

To run with the collector, use Node 24 or later from the repository root. After database
initialization and registration and dependency installation, run:

```sh
npm run dev -- --local --state-dir .tmp/collector-db
```

The administrator runs at `http://127.0.0.1:5180` and the collector at
`http://127.0.0.1:5188`. Port changes, configuration, and shutdown are covered in the
[integrated development guide](../../docs/backend/runtime.md#integrated-development-run).

Use Node 24 or later and install dependencies from the repository root lockfile.

```sh
# From the repository root
npm ci --ignore-scripts
npm run dev:admin -- --host 127.0.0.1 --port 5180 --strictPort
```

This standalone run also proxies `/v1` to the default collector at
`http://127.0.0.1:5188`. Set the server environment variable `TALLYFIN_COLLECTOR_ORIGIN` to use
another loopback HTTP port. The administrator UI handles `/auth/callback`. Without a collector, API
connection fails, but sample mode remains usable.

## Implementation Scope

- Per-project overview, event analysis, goals, settings, and 7/14/30-day filters.
- Event search, sorting, detail trends, and numeric tables for charts.
- Rename, validation, and reset. Changes exist only in memory and are reset on refresh.
- Sample states for loading, empty data, query errors, stale data, and no permission.
- Mobile menu and horizontal scrolling inside tables.
- Project creation and SDK connection guidance in API connection mode.
- Registered funnel-stage analysis, daily detail, and funnel CSV in the API connection goals screen.

The sample date is fixed at 2026-10-08. The total collection count includes screen views, and the
overview table shows only 4 key events. Completion rate is successful events divided by starts, and
is shown as uncomputable when the denominator is 0. Sample mode does not implement real cohort
calculation, authorization enforcement, API, database, SDK, or collector (API connection mode does
query the real same-origin administrator API). React and Recharts are the administrator app choices
under [ADR 0007](../../docs/adr/0007-admin-application.md).

## Validation

```sh
# From the repository root
npm run check:admin
```

Browser verification and visual comparison records are in
[initial design QA](../../prototypes/admin/design-qa.md). The production performance budget must be
verified separately for the collection SDK and administrator UI. The administrator bundle now
code-splits by screen and checks a 100 KiB gzip budget for the first static graph and a 500 kB budget
for each JavaScript file. Verification with a real authentication provider, production deployment,
and a service pilot remains.

## API Connection Mode

- The default endpoint is `/v1` on the current origin; other origins are outside this scope and are rejected.
- The administrator bearer token exists only in memory and is never written to localStorage, sessionStorage, cookies, queries, or logs. `Disconnect` clears the token, aborts in-flight requests, and clears queried data.
- The paths used are `GET /v1/projects`, `/projects/{id}/schemas/{version}`, `/summary`, `/events/{name}/daily`, `/workflows/{id}/daily`, and `/funnels/{funnelId}/daily`; `from` and `to` are calculated as today and the last 7/14/30 days in the project time zone. `/summary` and `/events/{name}/daily` also send the optional `source` (default browser).
- Event analysis chooses one property from the selected source's registered events as the breakdown, then queries counts and shares by value and the daily trend for the selected value with `GET .../events/{name}/daily?groupBy=<property>`. The share denominator is the event's total count and is not a conversion rate; displayed shares are rounded to one decimal place, so their sum can differ slightly from 100.0%. A denominator of 0 is not calculated and is shown as `—`. true, false, and null are distinct, and null is counted as a separate value for optional properties (no value) without fabricating totals. Changing the selected value with the value buttons updates the table and daily trend together. If the project, schema version, or event changes or the property disappears, the breakdown selection resets; when conditions change, in-flight queries are cancelled so late responses cannot overwrite the screen.
- The published-source selector in overview and event analysis (`source`, default browser) is included in queries, previous-period comparison, CSV input, and loading keys. Changing the source cancels in-flight queries and discards late responses.
- Rows from another source are labeled `Other source` and exported in CSV as `not_selected` or empty; server CSV filenames receive a `-server` suffix. Sample mode is unchanged.
- Completion rate and attempt count use workflow response values directly and are not inferred from event totals. Goals and workflows are fixed to the browser source, and server overview hides starts, successes, and completion rate. Funnel stage analysis combines the sources of registered stages and does not accept a `source` selection.
- The UI distinguishes 401, 403, 404, 503, network, format, empty registration, and empty aggregate results, and never fills a failure with 0 or sample values.

## OIDC Administrator Sign-In

The administrator console signs in with a public-client OIDC flow and PKCE (S256), and keeps access
and refresh tokens in memory only. The callback address is `/auth/callback` on the current origin.
State, nonce, and verifier are kept in a one-time 10-minute sessionStorage record and deleted before
code exchange. Refreshing requires signing in again, and disconnecting clears the local session.

The required build environment variables are `VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID`, and
`VITE_OIDC_SCOPE` (including `openid`). Optional values and the CORS, rotating-refresh, and
same-origin `/v1` routing requirements follow the
[OIDC connection guide](../../docs/backend/oidc.md#browser-administrator-sign-in). The real provider and API
audience are UNDECIDED, and real-provider sign-in has not been verified.

The optional `npm run verify:admin-login -- --channel chrome` verifies the path from the sign-in
button through callback, API query, token refresh, and sign-in again with a synthetic provider, the
real administrator source, and a local collector/D1. Setup and isolation scope are in the
[sign-in verification guide](../../tools/browser-bench/ADMIN-LOGIN.md).

## Project Settings Editing (API Connection)

The settings screen loads and edits name, status, allowed origins, and collection limits exactly as
configured on the server. Names are 1–80 characters, allowed origins are one per line up to 16,
requests per minute is 1–600, and UTC daily new receipts is 1–1000000; project ID and time zone are
read-only. While saving, inputs are disabled and progress is announced. If the server's canEdit is
false or the user lacks owner permission, the screen opens read-only. On a 409 conflict or lost
response, input is preserved, saving is locked, and the latest settings are compared with the input
so the user can choose `Use server settings` or `Keep my changes and review`. The registered event
and workflow table below is read-only. Actual save-path integration and verification figures are
recorded in the parent task.

## Schema Editing, Validation, and Publishing (API Connection)

In the event schema section below settings, query the version list and latest number, and edit the
definition as JSON. Loading a selected version changes the draft; the draft exists only in memory and
disappears when leaving the screen or project or refreshing. An owner chooses a new number, passes
definition validation, and selects privacy-review confirmation before publishing. A reader can
query and copy definitions only. Changing the draft or number cancels existing validation and review
confirmations.

On a concurrent-publish 409, permission change, or lost response, the draft is preserved and not
resent automatically. Check server state to see whether the submitted version is already stored with
the same content; if not, compare the latest definition with the draft and choose either the server
version or keeping the draft and revalidating. Publishing does not change the version used by the
product SDK. API and database contracts follow the
[administrator documentation](../../docs/backend/administrator.md).

## Project Creation and SDK Connection Guidance (API Connection)

In `Add project` on the toolbar, enter the name, public project ID (immutable after creation), IANA
time zone, and allowed origins; expand collection limits to set requests per minute and UTC daily
new receipts. The server checks creation permission; it is not inferred from project ownership. A
403 preserves input and asks the user to check permission. A 409 preserves input. An ID conflict
marks the ID field and moves focus there, while the creation-count limit shows only limit guidance.
If a response cannot be confirmed, inputs are locked, only a same-request creation check is offered,
and the request is not resent automatically. Once creation is confirmed, the project is added to the
list, selected, and opened in settings, showing project → event schema → SDK connection steps. Input
exists only in memory and disappears on refresh.

The SDK connection guidance below settings reads only the latest published schema and creates
connection code containing browser-source events and workflows; it excludes server-source events,
bearer tokens, and server-only definitions. Enter the collection server origin directly; only HTTPS
or local development addresses are accepted. Because the SDK is not yet a public package, the
instructions build it locally with `npm run build:browser` and connect from the repository. Code
copying offers manual selection if the clipboard fails. Publishing a new version updates the latest
number.

The schema section contains the event form (`SchemaEventForm`). Add and remove events in the form
and enter name, label, and source (browser or server), with name up to 48 characters and label up to
80. A new event starts with browser source and empty properties, and up to 50 events are allowed. It
shares the same draft as the collapsed `Edit JSON directly` editor, and form changes also cancel
validation and review confirmation. Other event keys, properties, and workflows are preserved; for
events linked to workflow start, success, or failure, only the label is editable. If the draft cannot
be parsed or represented in the form, the UI directs the user to `Edit JSON directly` and preserves
the draft. The form is read-only for readers. Properties are edited in the per-event property form,
and workflows in the workflow form.

Each event in the event form has a collapsible property form (`SchemaPropertyForm`). Add or remove
up to 4 properties and edit name (up to 48 characters), type (boolean, enum, or integer), required
status, collection purpose (up to 240 characters), allowed enum values (one per line), and integer
minimum and maximum. A new property uses an unused `property_N` name and starts as boolean, not
required, with an empty collection purpose. Changing the type resets only the previous type's allowed
values or range while preserving purpose and required status. Changing to a name already in use is
rejected without overwriting another property. Empty or incomplete integer values, integer strings
outside the safe range, and blank lines or duplicates in enum values are preserved in the draft
without automatic correction, so publication is blocked until server validation passes. The form
precomputes and explains the limit of 32 allowed values and 256 possible combinations; server
validation makes the final decision. For a property used in workflow `dimensions`, only collection
purpose is editable; name, type, required status, allowed values, range, and deletion are locked.
Property validation errors expand that event's property form and move focus to the field, and after
adding or deleting, focus moves to the new or next item. If the property definition cannot be
represented in the form, the UI directs the user to `Edit JSON directly` and preserves the draft.
The property form is read-only for readers.

The workflow form (`SchemaWorkflowForm`) is below the event form and above the collapsed
`Edit JSON directly` editor. Add or remove up to 10 workflows and edit ID (up to 48 characters),
display label (up to 80), start, success, and failure events, and comparison properties. Event
selection shows only browser-source events; an unregistered selected string is represented by an
`(unavailable)` option, an empty string remains a placeholder, and for a failure event, `null` is
distinct from an empty-string placeholder and is shown as `No failure stage`. Comparison properties
are selected from the union of required properties of the stage events and those already selected,
up to 4; when 4 are selected, only new items are disabled and existing selections can still be
cleared. Duplicate stages and mismatched comparison-property types or allowed values produce live
warnings, with server validation making the final decision. Duplicate IDs are rejected locally and
focus moves to the problem input; after adding or deleting, focus moves to the new or next item (or
the add button when none exists). Workflow validation errors move focus to the form field. If the
draft cannot be parsed or represented, the UI directs the user to `Edit JSON directly` and preserves
the draft. The workflow form is read-only for readers, and validation, publish, review, and view-more
locks still apply.

## Previous Period Comparison — 2026-10-10

When `Compare with previous period` is enabled in API connection overview, event analysis, or goals,
the UI compares the last 7/14/30 days (including today) or a directly selected period with the
immediately preceding period of the same number of days. Counts show change rate (%), and completion
rates show difference (%p); a previous count of 0 or a null completion rate is shown as
uncomputable. Values for today and for start-day cohorts that are not final can change. If comparison
fails, current results remain and `Retry comparison` queries only the previous period again.
Turning it off cancels an in-flight comparison. It uses the existing API with the same project,
schema, and time zone, and sample mode is unchanged. Goal completion by property and event-property
breakdown use the same switch and make one more request to the existing API with the same breakdown.

## CSV Export — 2026-10-10

Press `Download CSV` in API connection overview, event analysis, or goals. It uses only the data
currently verified and makes no additional API request. Each row includes the current period, schema,
time zone, search term, selected event, and breakdown. When comparison is enabled, the previous
period and comparison deltas are included. Event search applies to event totals, while the comparison
table covers all registered events like the screen. Breakdown detail includes every observed value
and daily figure. If goal property breakdown is enabled, it includes current and previous rows by
value and comparison metric rows by value (start and success count change %, completion rate %p),
and downloading is locked while comparison is enabled and any breakdown is not ready. CSV uses
record_type to distinguish rows and does not add totals and daily rows together. period is
current/previous/comparison, counts are raw numeric values, rates are percent, and completion-rate
differences are percentage_point. Empty is different from 0, and value_type distinguishes null,
false, numeric 0, and string. UTF-8 BOM preserves Korean characters. Text that could be interpreted
as a formula can receive a leading apostrophe. If detail or comparison is loading or in error,
finish it or close detail and turn off comparison before downloading. Tokens are never included in
the CSV.

## Workflow Completion Rate by Property — 2026-10-10

In API connection goals, choose a registered comparison property under `Start-time breakdown`.
Each value shows starts, successes, failures, pending, and completion rate, and the value button
opens detail by start date. Completion rate is successes divided by starts for each value; 0 attempts
shows `—`, and failures for a workflow without a failure stage show `—`. Selecting `No breakdown`
releases the request and analysis. On failure, the whole goal remains and
retry property breakdown recovers it. CSV download is unavailable during an error or query. When
`Compare with previous period` is enabled, it makes one more request with the same breakdown for the
immediately preceding period of the same number of days and adds a
`Previous-period comparison by property` table. Each value shows current and previous starts,
successes, completion rates, and completion-rate difference (%p); values observed in either period
are combined, a value absent from one period has count 0, and a period with 0 starts shows `—` for
rate and difference. If only comparison fails, current-period results remain and
`Retry property comparison` queries only the previous period. Turning comparison off removes the
additional request and comparison table.

CSV rows workflow_property_summary, workflow_property_total, and workflow_property_day contain the
breakdown, value type, and observed numeric values, and add previous-period rows and per-value
comparison metric rows (workflow_property_comparison, start and success count change %, completion
rate %p). If any breakdown is not ready while comparison is enabled, download is locked; turning it
off includes only current-period rows. Even an empty result retains breakdown conditions in summary
rows. The API and administrator UI must be updated together for the new query to work.

## Event Property Previous-Period Comparison — 2026-10-10

In API connection event analysis, choose a property as the breakdown and enable
`Compare with previous period`. A separate hook (`useEventPropertyComparison`) queries the
immediately preceding period of the same number of days with the same breakdown through the existing
daily API one more time and adds a `{breakdown property} values previous-period comparison` table
below the current table (for example, `tool values previous-period comparison`). The current-period
table and selected-value daily trend remain, while the comparison table shows current and previous
counts and change rate (%) and share and share difference (%p) for each value. Share is the value
divided by all events of the selected event in that period, not a conversion rate. Values observed
in either period are combined; null, false, and 0 remain distinct; a value absent from one period has
count 0; share and difference are `—` when the period's total event count is 0; and change rate is
`—` when the previous count is 0. If only comparison fails, current results and the chart remain and
`Retry event property comparison` queries only the previous period. Turning comparison off or
clearing the breakdown removes the additional request and comparison table. Event analysis without a
selected breakdown sends no previous-period detail query.

CSV property-value rows contain selected-event totals, daily figures, and property-value figures for
current and previous periods, and add per-value comparison metric rows (property_comparison,
metric=count/share, previous_value, change, change_unit). No value is left as an empty cell while
preserving its type. Download is locked if comparison for the selected breakdown is not ready or
failed. Clearing the breakdown excludes property detail and comparison rows while retaining the
overall event-period comparison. Turning comparison off includes only current-period rows.

## Collection Status Diagnostics — 2026-10-10

At the top of API connection settings, inspect project collection configuration, selected schema
status, the project-wide last new receipt, today's browser events for the selected version, and
configured limits. A missing record and a query failure are distinguished, and infrequent receipts
alone are not treated as a failure. Service addresses are compared with the origin allowlist only
inside the tab. They are neither sent nor stored. `Recheck collection status` refreshes explicitly;
there is no automatic polling or test event. Status also refreshes when the project or version
changes and when settings are saved. The panel shows rejected request count and last time for the
project across the most recent 7 UTC dates and lets the user expand a 10-cause and daily table.
Failure of the rejection aggregate does not remove settings, schema, or receipt records and never
fills it with 0. Save failures and pre-adoption history can be missing; rejection rate and remaining
quota are not inferred. Rejection timestamps are UTC and distinct from event aggregates in the project
time zone. `Items to check when collection is absent` is a check order, not a failure history.

## Direct Selection of Query Period

In API connection, select `Custom` in the top query period, enter a start and end date, and press
`Apply period`. It queries up to 31 days inclusive within the most recent 90 days in the project time
zone. While editing, existing results and the CSV basis remain and the UI marks the period as not yet
applied. Applied dates are reflected in overview, events, goals, property detail, previous-period
comparison, and CSV. If the previous comparison period falls outside retention, only current results
remain and turning comparison off allows CSV download. Date draft and applied values exist only in
memory and reset when the project, time zone, default period, or connection changes. Sample and
settings screens do not include the date form.

## Change History (API Connection) — 2026-10-11

The settings screen adds an owner-only change history section (`LiveAdminChanges`) below the
permissions section. Readers see guidance only and no controller is created, so history API is not
called. It reads records from the last 90 days, 25 per page, and provides only
`Refresh from beginning`, `Next page`, and `Retry this page`; there is no automatic polling.
When a settings or permission save emits a refresh signal, the controller is recreated and reads
from the first page. Screen lock disables only the buttons and does not erase records already read.

The table has time (project time zone), actor, and change columns. An administrator API change shows
the account identifier and issuer; an offline CLI change shows `Local operator` and
`Changed by registered tool`. A change description covers project creation, the localized name of
each changed setting, schema publication or status changes with version number, and grant
assignment, role change, or revocation with its target and previous and new roles. The short header
is "API and registered-tool changes recorded during the last 90 days since adoption"; it does not
backfill earlier changes, changes through paths not in the list are absent, and the list does not
mean every change was retained. The fuller explanation is in
[frontend design](../../docs/frontend/FRONTEND_DESIGN.md). Loading, empty history, and errors are
distinct; 401 and 403 close the section and notify the parent's global lock. API, database, and SDK
contracts and dependencies are unchanged, and browser verification figures are recorded upstream.

## Server-Only Project Connection — 2026-10-11

A schema can be published with server events and empty workflows and no browser events. If browser
allowed origins are empty in project creation or settings, the value is stored as
allowedOrigins=[] and browser collection is blocked. For a server-only project, SDK connection
guidance defaults to server; for a mixed definition, the user selects browser or server and only
that source is projected. Server code receives a getToken function from the actual service that
provides a dedicated publisher token, and the guidance says not to put the server SDK or token in the
browser. It adds no token input, test-event send, or assumption about a specific production identity
provider.

For a server-only project, collection status diagnostics default to server counts and can switch
source for a separate check. Server diagnostics show the order of publishing authentication,
permission, and send-result checks; browser diagnostics show allowed-origin comparison and guidance
for blocking an empty list. Last-receipt and rejection records are project-wide and independent of
the source selector. If schema query fails, connection code is cleared and recovered by querying
again.

## Funnel Analysis and CSV (API Connection) — 2026-10-11

The goals screen is divided into `LiveGoals` (workflow completion rate) and `LiveFunnels` (funnel
analysis). A funnel is read with
`GET /v1/projects/{projectId}/funnels/{funnelId}/daily` only after selection from the registered
list; no request is made before selection. The start-date cohort table combines all dimensions and
sources and shows stage event, source, reached count, reach relative to the first stage, conversion
relative to the previous stage, unreached count for the next stage, and a progress bar. It also shows
a daily summary and expands that date's stage detail when a date is selected. It uses summary
completed and started counts and completion rate, marks today and not-yet-final dates as aggregating,
and explains that unreached counts include in-progress and undelivered runs.

The separate funnel CSV exports verified summary and daily stage values with source and provisional
status, leaving ratios without a denominator empty. Its file and columns are distinct from event and
workflow CSV. The query layer validates the closed response shape and agreement with definition,
period, counts, ratios, and the selected registry. Deselecting, or changing project, period, or
connection, cancels in-flight queries and masks old results and CSV; 403 and malformed responses
produce an error and retry instead of 0. The funnel-specific edit form is connected as described
below. There are no additional package, database, API, SDK, or CI changes.

## Administrator UI Lazy Loading — 2026-10-11

API mode, the settings workspace, goals, and project creation load their code when opened. Parent
connection state remains across menu changes. If loading fails, the UI asks for a refresh and notes
that refresh resets input and directly connected tokens. After a build,
`npm run test:bundle` checks the actual manifest graph's 100 KiB initial gzip and 500 kB per-JS
budgets and the lazy-loading boundaries. This build-dependent check is not included in `npm test`.

## Funnel Stage Editing (API Connection) — 2026-10-11

In the schema editor in settings, edit funnel ID and name, event selection by source, stage add,
delete, and reorder, and required-property comparison criteria through a form. It reuses the JSON
draft, server validation, privacy review, and publishing. Only an owner can edit; readers are
read-only. JSON that cannot be represented is preserved and the UI directs the user to direct editing.
Server error paths and stage move or delete move focus to the relevant field. The absence of funnels
in an existing schema is preserved on read, and events, properties, workflows, and additional keys
are not changed. Property breakdown in the analysis screen and funnel previous-period comparison are
follow-up work.
