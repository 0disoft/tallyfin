# Validation

## Connected workspace text readability - 2026-10-28

- Replaced per-screen 10-15.5px supporting/control text with shared 1rem body
  and 0.875rem metadata tokens across Overview, Events, Goals and detailed
  Settings. Compact actions use the 2.75rem target token. Existing large
  headings, metric sizes and locale-specific Noto families are retained.
- Headers, comparison labels, CSV actions and event-total captions wrap at
  narrow widths. Overview's subtitle uses normal flow. Fixed French event
  and Spanish goal overflow found during the responsive verification.
- Passed `typecheck:admin`, `build:admin`, emitted bundle tests (2),
  `verify:admin-overview` and `verify:admin-language-matrix`. The matrix covers
  twelve locales at 1440px and 390px, including all five Settings tabs, draft
  retention, locale-independent CSV, no repeated reads on locale changes,
  zero API writes and zero page errors. Evidence:
  `.tmp/admin-language-matrix-QAgdrr` and `.tmp/admin-overview-i73Cki`.
- Browser computed-style checks confirm 16px event search/close controls,
  14px chart ticks and metadata, 44px detail-close height, and 16px Settings
  field labels with 14px help. Inspected local fixture captures are in
  `.tmp/main-readability-20261028`. These are not production-auth evidence.
- Updated admin guidance and frontend design. Backend/auth/full-repository
  suites and full accessibility testing were skipped for this CSS-only
  change. No API/DB, dependencies, Worker, runner or hygiene changes. No push
  or deployment. Schema editor defaults and permission-table layout are
  separate follow-up work.

## Locale-specific Noto Sans typography - 2026-10-28

- Replaced the Inter package/import with compatible-major Noto Sans. Korean
  prioritizes Noto Sans KR, Chinese SC, Japanese JP, Hindi Devanagari and Thai
  Thai; the remaining seven languages prioritize Noto Sans. Centralized the
  locale stack in a CSS custom property and removed local Inter overrides in
  event/goal controls. Monospace data/code styles are retained. Script fonts
  remain lazy-loaded and all six upstream OFL notices are emitted unchanged.
- Passed `typecheck:admin`, `build:admin`, font-asset tests (8), emitted bundle
  checks (2) and npm install audit (zero vulnerabilities). Browser checks cover
  all twelve locale stacks and font readiness; all twelve have no horizontal
  overflow at measured 390px. Evidence: `.tmp/login-design/noto-font-checks.json`
  and `06-noto-sans.jpg`. No production deployment was performed.
- Updated frontend design and admin guidance. Auth/backend/full-repository
  suites were skipped for this typography change. No API/DB, auth-policy,
  Worker, CI/runner or hygiene changes. Package and lockfile changes replace
  one self-hosted font dependency; no push or deployment.

## Login text readability - 2026-10-28

- Increased login supporting text and controls from 12-14px to 1rem (16px
  with the default root size), including manual-connection help and errors.
  Darkened supporting text/placeholders and enlarged disclosure/language targets.
  Heading sizes are retained. Scoped selectors override compact-shell help.
- Passed `build:admin` and browser computed-style/visual checks on desktop and
  measured 390px mobile: all four visible help paragraphs, labels and inputs
  are 16px, with no document horizontal overflow after expanding the form.
  Capture: `.tmp/login-design/05-readable-text.jpg`.
- Updated frontend design and admin guidance. CSS-only change: auth/unit and
  backend suites were not repeated. No API/DB, CI/runner, hygiene or dependency
  changes, push or deployment; production and full accessibility checks skipped.

## Focused administrator login - 2026-10-28

- Replaced the unbounded disconnected workspace with a branded 500px login
  card. Analysis navigation, report dates and the analysis footer are hidden
  while disconnected; language selection stays available. Direct-token fields
  stay in a collapsed disclosure. Without a configured provider, the demo is
  the available primary action. Connected reauthentication stays compact.
- Passed `typecheck:admin`, `build:admin`, focused authentication and locale
  tests (17) and emitted bundle tests (2), retaining the 100 KiB initial JS
  budget. The existing `verify:admin-login` smoke now opens connection and
  Settings tabs before checking their controls, matching the prior redesign.
  It passes PKCE, signed reads, password-menu access, rotating refresh,
  invalid-state rejection, expiry recovery, unsaved-draft protection, disconnect
  and reload checks: zero page errors and zero API writes.
- Inspected desktop and mobile captures in `.tmp/login-design/`. All twelve
  languages render at a measured 390 CSS pixels without document horizontal
  overflow; the expanded disclosure and endpoint value survive every switch.
  Main title uses h1, controls retain labels, and decorative icons are hidden
  from assistive technology. A full accessibility audit was not performed.
- Updated `docs/frontend/FRONTEND_DESIGN.md`, `apps/admin/AGENTS.md` and
  `design-qa.md`. No API/DB, auth-policy, dependency, Worker, repository-hygiene
  or CI/runner changes. Backend/full-repository and Sites checks were skipped
  for this UI-only change. Production authentication/deployment was not tested;
  the local development server remains running. No push or deployment.

## Twelve-language admin activation - 2026-10-28

- Adopted the exact target set from `zdp-architecture`'s
  `docs/45-cross-cutting-product-standards.md`: en, zh, es, fr, hi, ko, ja, vi,
  ru, id, ms, th. Added ten languages across all seven namespaces: 1,695 keys
  per locale, 20,340 localized entries in total. Translation used the configured
  CommandCode DeepSeek 4.1 Flash route with high reasoning. Source variables
  and ASCII numeric policies were checked during authoring; committed catalogs
  are independent of the model/proxy and require no translation service.
- All twelve languages are selectable and persist independently of auth.
  English is the base/fallback; before React mounts, restoration selects the
  saved language or Korean for a new session. The English-only boot shell
  keeps other catalog payloads deferred. Unknown preferences select English.
  Four additional scripts use self-hosted lazy fonts; all six font licenses
  ship unchanged. Gregorian years and project timezones remain stable.
- Passed `typecheck:admin`, `build:admin`, bundle tests (2), and the full admin
  unit suite (391, concurrency 2). Locale tests check complete key sets, real
  ICU parsing/contracts and format all 20,340 entries without missing-key or
  formatting errors; opaque helper data and HTTP status captures are retained.
  Initial static JS is 102,004 gzip bytes, below the unchanged 102,400-byte cap.
- Passed `verify:admin-language-matrix`: twelve languages times event/goal/
  settings views (36 combinations), all five Settings tabs, 1440/390px widths,
  and actual Chinese/Japanese/Devanagari/Thai font loads. Event/goal selection,
  project validation and JSON drafts survive switches; CSV bytes match across
  all languages. Locale and tab changes cause no additional API reads, writes
  or authorization. Japanese preference restores after reload with credentials
  cleared. `.tmp/admin-language-matrix-5870O4/report.json` records one login,
  32 fixture reads, zero writes, zero page errors and zero route errors.
- Passed `verify:admin-overview` after twelve-language activation: live English
  catalog edits retain an unsaved settings draft, locale survives reload,
  selection/session are retained and existing overview recovery still works.
  `.tmp/admin-overview-YZEvju/report.json`: zero page/route errors and writes.
- Updated sources of truth: this record, `docs/frontend/FRONTEND_DESIGN.md` and
  `apps/admin/AGENTS.md`; captures/review are in `design-qa.md`. The root package
  adds only the opt-in local `verify:admin-language-matrix` command. No API/DB,
  Worker, auth policy, repository hygiene or CI/runner changes. Architecture
  documents were read, not edited. Backend/full-repository and Sites packaging
  checks were skipped for this admin-only change. No push/deploy or production
  verification; independent native-speaker proofreading was not performed.

## ZDP language expansion foundation - 2026-10-28

- Added the twelve-language registry from architecture product standards,
  native selector labels, English base/fallback and safe saved preferences.
  Korean remains the no-preference initial language. Additional languages
  remain inactive until their complete catalogs and browser checks are ready.
- Added four compatible-major self-hosted script fonts with lazy stylesheet
  loading and original OFL assets. Install audit reports zero vulnerabilities.
  Gregorian date formatting preserves calendar years in Thai as well as
  project timezone semantics in all languages.
- Passed `typecheck:admin` and locale/font tests (13). Full translation build
  and multilingual browser checks belong to the following catalog activation
  step; the existing KO/EN active set still has complete translations.
- Updated `docs/frontend/FRONTEND_DESIGN.md` and this record. No API/DB,
  Worker, auth-policy, CI/runner or repository hygiene changes. No push/deploy.

## Saylo detailed admin screens - 2026-10-28

- Extended KO/EN coverage to event details, property/period comparisons,
  workflows/funnels, all five Settings tabs, schema forms/files/server drafts,
  SDK guidance, diagnostics, operational reports, access controls and login.
  Seven catalog pairs contain 1,695 matching keys per locale. Explicit helper
  message templates translate stored errors at render time; configured labels,
  identifiers, raw values, JSON drafts, generated SDK code and CSV remain data.
- The stable Saylo instance now loads catalogs through the lazy source. The
  shell starts with `admin`; detailed catalogs load with the workspace. Locale
  loading completes before its snapshot changes, with a retryable failure
  indicator. Both locales must be complete at build time. Sample-only screens
  and navigation are deferred; initial static JS is 100,408 gzip bytes, below
  the unchanged 102,400-byte cap. No dependencies or budget limits changed.
- Passed `typecheck:admin`, `build:admin`, emitted bundle tests (2), all admin
  unit tests (387 with concurrency 2), and the focused locale suite (5).
  Actual component render tests use real KO/EN catalogs through an isolated
  fixture rather than importing Vite virtual modules into Node.
- Passed `verify:admin-locales`: event/goal selection, project-name and JSON
  drafts survive language changes; stored validation/errors retranslate;
  CSV bytes remain identical. Locale changes issue no additional API reads,
  writes or authorization. All Settings tabs and 1440/390px layouts pass.
  `.tmp/admin-locales-FCnEgf/report.json` records one authorization, zero
  writes and zero page/route errors. Captures are reviewed in `design-qa.md`.
- Passed existing `verify:admin-overview`, `verify:admin-settings-workspace`,
  `verify:admin-goal-access`, `verify:admin-schema-comparison` and
  `verify:admin-server-draft` browser checks. Overview still covers catalog edits retaining a
  draft and locale preference after reload. Schema comparisons and server-draft
  checks retain conflict, lost-response, permission and cancellation coverage.
- A repeated schema-editor regression check exposed a focus timing race:
  the animation frame could run before the form-mode DOM committed. The focus
  effect now uses the layout phase. The goal-access check also explicitly
  expands connection controls before disconnecting. Its final 17-scenario run
  passes representative/failure editors, current/previous 403s, stale table and
  export clearing, recovery and disconnect, with zero page/route errors:
  `.tmp/admin-goal-access-XCmeNm/report.json`.
- Source-of-truth updates: this record, `docs/frontend/FRONTEND_DESIGN.md` and
  `apps/admin/AGENTS.md`. Added only a local `verify:admin-locales` command;
  API/DB contracts, Workers, auth policy, repository hygiene and CI/runners
  are unchanged. Backend/full-repository and Sites packaging checks were
  skipped for this admin-only change. Production verification, push and
  deployment were not performed.

## Saylo Korean/English admin pilot - 2026-10-28

- Added published `@0disoft/saylo-core`/`saylo-react` runtime dependencies and
  `saylo-vite`/`saylo-typegen` dev dependencies at compatible alpha.9 ranges.
  Install audit reported zero vulnerabilities. Existing React 19/Vite 8 and
  Apache-2.0 remain. The lockfile records the installed artifacts; no CI jobs,
  Worker, API/DB contract, authentication policy or hygiene rules changed.
- One stable client store/Provider, 119 matching KO/EN keys, typed message calls,
  a header language selector and optional independent locale persistence cover
  shell/common controls and Overview. User-defined labels, identifiers, report
  dates and project timezones remain data. An English notice identifies the
  detailed pages, dialogs and advanced sections still in Korean.
- Passed `typecheck:admin`, `build:admin`, admin bundle tests (2), and admin unit
  tests (385 with concurrency 2, including 3 locale/catalog tests). Initial
  static JS graph: 99,984 gzip bytes against the unchanged 102,400-byte limit.
- Passed `verify:admin-overview`: switching locale retains session/project with
  no additional aggregate read or authorization; a live catalog edit retains
  the unsaved project-name draft; language selection survives document reload.
  Existing counts, lazy services, 503/recovery, navigation and responsive checks
  still pass. Final `.tmp/admin-overview-Ln3ECF/report.json` records one login,
  zero page/route errors and zero API writes. English 1440/390px screenshots and
  visual review are recorded in `design-qa.md`; IAB preview was also inspected.
- Initial integration exposed Saylo's exclusive typegen output lock when an
  isolated preview and build ran together. Removed Vite-owned typegen; the
  explicit `i18n:types` command (also run by typecheck) remains the sole generator.
  Build and browser checks pass after this change.
- Source-of-truth updates: this record, `docs/frontend/FRONTEND_DESIGN.md` and
  the durable pilot scope in `apps/admin/AGENTS.md`. Backend/full-repository and
  Sites packaging checks were skipped for this bounded admin-only change.
  Production verification, push and deployment were not performed.

## Overview collection and completion redesign - 2026-10-28

- Added the compact Overview header/toolbar, source-aware KPI strip, daily-start
  bar chart, ranked event list, outcome strip and collapsed service comparison.
  Missing failure definitions remain undefined and pending attempts stay distinct
  from confirmed failures. Existing overview error/retry behavior is preserved.
- Passed `typecheck:admin`, `build:admin`, admin bundle checks (2 tests), admin
  unit tests (382 tests with concurrency 2), `verify:admin-analysis-access`,
  `verify:admin-overview`, and `git diff --check`.
- The new isolated browser check covers fixture totals (24,860 events, 5,000
  starts, 4,320 successes, 86.4% completion, 680 pending), undefined failures,
  seven rendered bars with nonzero chart width, lazy service reads (zero before
  expanding; one after), readable service columns, server source, comparison
  against zero, workflow 503/retry, absent representative workflow, navigation,
  and 390/768/1280px layouts without document-wide horizontal overflow.
  Final report: `.tmp/admin-overview-7ajArc/report.json`; zero page errors,
  route errors and API writes. Screenshots and visual review: `design-qa.md`.
- Updated sources of truth: `docs/frontend/FRONTEND_DESIGN.md` and this record;
  recorded the selected design in `apps/admin/AGENTS.md`. No API/DB contract,
  Worker, dependency, repository hygiene or CI/runner changes. The root package
  adds only the local `verify:admin-overview` command.
- Backend/full-repository suites and Sites packaging were skipped because this
  change affects the existing admin presentation only. No production verification,
  push or deployment. Rollback: revert the Overview redesign commit.

## Settings tabs and schema workbench redesign — 2026-10-28

- Settings uses five horizontal tabs: project, collection diagnostics, event
  schema, SDK connection and access. Project fields use flat labeled sections
  with persistent save/reset actions. The schema editor sits beside validation
  and manual privacy checks, with JSON/form modes and collapsed draft/version
  utilities. Actual collection limits and paused-project semantics remain.
- Hidden panels stay mounted: tab changes retain drafts, unresolved writes,
  permission locks and cross-section coordination. Keyboard arrows/Home/End
  select tabs. Settings omits the report date range while retaining connection
  and account controls. Visual and 390/768/1280px checks are in `design-qa.md`.
- Passed typecheck, portable admin build, emitted bundle checks (2 tests), and
  admin unit tests (382 tests, test-concurrency 2). One initial fully parallel
  run hit an unrelated 10ms read-scheduler timing assertion; it passed with
  bounded concurrency without changing that implementation or test.
- Passed `verify:admin-settings-workspace`, `verify:admin-settings-recovery`,
  `verify:admin-settings-navigation`, `verify:admin-schema-comparison`,
  `verify:admin-server-draft`, `verify:admin-access`, `verify:admin-goal-access`,
  `verify:admin-mode-exit`, `verify:admin-onboarding`, and `git diff --check`.
  Existing browser checks now select visible tabs before interacting. The
  onboarding check executes generated SDK code, verifies one event in local D1
  and the event explorer, and covers file-read cancellation/timeout/recovery.
- Source-of-truth updates: this record and `docs/frontend/FRONTEND_DESIGN.md`.
  No API/DB contract, Worker, dependency, hygiene or CI/runner changes. Backend
  and full-repository suites and Sites packaging were skipped for this local
  admin UI change. Production behavior remains unverified; no push or deployment.

## Goals explorer and inspector redesign — 2026-10-28

- Replaced the long sequence of workflow/funnel sections with a grouped goal
  explorer and selected inspector. Workflow overview shows cohort completion,
  started/succeeded/confirmed-failed/pending attempts and a daily completion
  chart; detailed failure, duration and property views reuse validated reads.
  Funnel stages show registered labels, keys, sources, reach and next-stage
  non-reach. Workflow comparison shows current/previous/signed difference (%p
  for completion rate), preserving unknown measurements and prior zero starts.
- Property reads cancel on panel/goal/context changes, and unmounted selections
  are cleared from workflow export details. The existing CSV permission and
  readiness gates remain. Expanded connection controls preserve refresh,
  schema selection, password navigation, disconnect and draft-exit guards.
- Passed `npm run typecheck:admin`, `npm run test:admin` (382 tests),
  `npm run build:admin`, admin `test:bundle` (2 tests), and
  `npm run verify:admin-analysis-access` (event access/schema/export isolation).
- Passed `npm run verify:admin-goal-access`: 17 scenario groups, 7 real local-D1
  permission denials, workflow recovery, current/prior workflow and funnel
  failures, exported CSV contents, partial/missing historical measurements,
  project switches, late-denial isolation and disconnect cleanup. Added goal
  search-without-selection-loss, keyboard funnel selection, default overview,
  registered stage journey, and 390/768/1280px horizontal-overflow assertions.
  A resized Recharts surface briefly kept its previous width; the chart viewport
  now clips that transient width without clipping scrollable data tables.
- Evidence: `.tmp/admin-goal-access-zVAAMY/report.json` and its desktop/mobile
  captures; visual review and accepted mock adaptations are in `design-qa.md`.
- No standalone admin lint script is configured; TypeScript, unit/render tests,
  browser checks and `git diff --check` cover this change. Sites packaging was
  not run because this is an existing Cloudflare app edit, not a Sites handoff.
  Production deployment and real-traffic measurements are outside this local
  UI change. No backend API, schema or production credentials were changed.

## Event explorer and period comparison redesign — 2026-10-28

- API event analysis now uses a searchable, source-scoped explorer beside the
  selected event's total, daily trend, property breakdown and daily table.
  Comparison mode replaces the explorer with current/previous counts, absolute
  changes, percentage changes and bars with a shared scale. Unknown counts stay
  distinct from zero; a zero previous count never renders an infinite percentage.
- Project and period controls remain in the header. Advanced connection/schema
  controls are collapsed, without removing login recovery, password navigation,
  refresh, disconnect, draft guards or server-side permission checks.
- Passed: `npm run typecheck:admin`, `npm run test:admin` (380 tests),
  `npm run build:admin`, `npm run verify:admin-analysis-access`, and
  `git diff --check`. The browser access suite verified oversized-response and
  timezone-error recovery, permission revocation, cleared denied data, disabled
  denied CSV export, project/version isolation, ignored late denials and
  disconnect cleanup; page errors and administrator API writes were both zero.
- The isolated example API preview was inspected in the in-app browser for
  event selection, property/daily tabs, search-empty and source-empty states,
  comparison, and responsive layout. It uses example data and makes no production
  service calls. Visual comparison evidence and intentional mock differences
  are recorded in `design-qa.md`. Shell and analysis styles are separate files,
  each below 40 KB, preserving cascade order.
- Source-of-truth changes: this record and `docs/frontend/FRONTEND_DESIGN.md`.
  No API/DB contract, Worker, dependency, hygiene or CI/runner change. Backend and
  full-repository suites were skipped for this administrator-only change.
  Production authentication/data and deployment remain unverified; no push,
  deployment or publication was performed.

## Direct administrator login recovery — 2026-10-28

- HTTP 401 from any administrator API route, including identity checks and
  mutations, or a failed token refresh now exposes the existing administrator
  login panel above the connected workspace. Disconnecting first is unnecessary.
  HTTP 403 and ordinary server failures do not trigger login recovery.
- Authentication failure is observed at response headers, before a potentially
  stalled error body. Observer failures cannot replace the API error, and
  cancelled/disposed requests cannot trigger recovery for another connection.
- Editors stay mounted when authentication fails. Starting login uses the
  existing connection-wide draft exit guard, then disposes the old API client
  and its credentials before starting a fresh OIDC transaction. Cancelling the
  exit confirmation preserves the draft and connection.
- Passed: `npm run typecheck:admin`, `npm run test:admin` (378 tests),
  `npm run build:admin`, `npm run verify:admin-login`, and `git diff --check`.
  The local Chromium/real local D1 fixture verified refresh-failure and identity
  401 recovery without disconnect, 403 separation, draft retention, declined and
  accepted exit confirmation, successful relogin, manual disconnect and reload.
  Browser page errors and administrator API writes were both zero.
- Only this validation record changed among source-of-truth documents. No
  API/DB contract, Worker configuration, dependency, hygiene or CI/runner change.
  Backend/full-repository suites and production login were not rerun for this
  administrator-only change. This record establishes local verification only;
  no push, deployment or publication was performed.

## Authentication body cleanup deployment — 2026-10-26

- Deployed source `9d9d6b8` to `tallyfin-auth` version
  `dcf73e41-bd30-4efd-86dc-fa428c6077fa`; deployment readback confirms 100%.
  The prepared production authentication config was compared with live variables,
  D1 identity and service/object bindings before deployment. Version readback
  confirms all bindings and runtime settings match the previous version exactly.
- Collector remains `abecfc07-3648-4f4d-9159-abf351d00298` and administrator
  remains `098a20ae-046f-4947-95cd-56037c1d8744`, both at 100%. Their source
  had not changed since the already deployed `9f92c62` baseline; only the auth
  Worker required a new deployment. SDK distribution and site preparation are
  repository tools, not an npm publication or a remote site registration.
- Fresh `npm run typecheck`, 69 contract checks, and the production auth
  `wrangler deploy --dry-run` passed. Reused the unchanged source's passing
  auth tests (13), site integration tests (4), SDK identity test (1) and offline
  SDK consumer verification. No unrelated full-suite or remote load rerun.
- All nine post-deployment smoke checks passed: auth health, sign-in HTML,
  public JWKS, OIDC metadata and administrator HTML returned 200; the locked
  password page returned 302, closed signup 404, a 16,385-byte authentication
  body 413, and unauthenticated administrator identity 401. Public JWKS contained
  keys without private material and metadata retained the configured issuer.
  These checks do not establish successful login or authenticated project reads;
  no password, session, credential or data reset was performed.
- The inherited API token could read deployments but its upload was denied.
  Reused the existing, same-account Wrangler OAuth session without exposing its
  token. Local DNS lookups subsequently timed out; process-local alternate DNS
  restored access while preserving HTTPS hostname/certificate verification.
  Readback confirmed no release version existed before retrying the upload.
  Global environment, DNS settings and credentials were not changed.
- Rollback remains available through auth version
  `c28718cb-2605-4fbd-b879-7078cec7fc51`. No migration, new resource, secret
  replacement, API/DB/SDK contract, dependency, hygiene or CI/runner change.
  The optional ingress limiter remains inactive and no production quota or
  threshold was changed. Detailed local receipts are in
  `.tmp/auth-body-release-deployment.json` and `.tmp/auth-body-release-smoke.json`.

## Authentication request body cleanup — 2026-10-26

- Reproduced the original `boundedRequest` behavior in Node and the installed
  workerd: a 16,385-byte stream with a held underlying cancellation promise
  remained pending after caller abort and a 50 ms observation window. The
  reproduction resolved that promise afterwards and disposed its runtime.
  This is a controlled local failure case, not an observed production incident.
- Extracted the body reader into `apps/auth/src/bounded-body.ts`. Cleanup no
  longer awaits transport cancellation. Abnormal exits request cancellation
  once, remove the abort listener and release the reader lock in `finally`.
  Successful EOF does not cancel. The original error or abort reason propagates;
  rejected cleanup cannot replace the size-limit error. Completion of underlying
  transport cleanup itself is not guaranteed by this change.
- The 16 KiB cap, 10-second body deadline, request-header pseudonymization,
  authentication/authorization order and public response contracts are unchanged.
  `RangeError` still maps to HTTP 413; other body failures retain HTTP 503 handling.
- `npm run test:auth`: 13/13 passed. Six focused reader cases cover empty input,
  16,383/16,384/16,385-byte boundaries, stalled and rejected cancellation,
  pre-aborted input, abort during a pending read, and stream errors. A seventh
  new case verifies stalled cancellation in workerd; the existing real Worker/D1
  test also confirms oversized public requests return 413 and login still succeeds.
  The maintenance failure diagnostic in the suite is intentional failure coverage.
- `npm run auth:types`: passed with generated Worker bindings. Extraction initially
  widened the returned buffer type; declaring its actually allocated ArrayBuffer
  backing fixed that compile error without another allocation or runtime change.
  `git diff --check`: passed.
- Only this validation record changed among the source-of-truth documents. API/DB
  schemas, SDKs, dependencies, hygiene rules, CI/runners and Worker configuration
  are unchanged. Unrelated suites and remote fault/load tests were not rerun for
  this isolated auth-body change. No push, deployment or publication.

## Independent-site SDK delivery — 2026-10-26

- `sdk:bundle` built clean source commit `231e2f38bcca03d1d1705b92c336dfe65a9b8a17`
  (tree `62b682b9da2730f4cb515254d832bbb91ab50c07`). Both tarballs installed
  offline outside this checkout. Browser, funnel and server ESM entry points,
  consumer declaration compilation, exact package contents and LICENSE/NOTICE
  verification passed. Packages remain private at `0.0.0`; no npm publication.
- Browser tarball: 10,900 bytes, SHA-256
  `afbdbb16e1c009e213372e900711d53667332102ee8b37179b3f720f9150a386`.
  Server tarball: 9,671 bytes, SHA-256
  `a6750d11682b014ed1758e5dbacf0eef3eed27d8e3b3530720a0f4007deabbfc`.
- Source-identity/output protection: 1 test passed, covering committed identity,
  rejection of tracked edits and untracked input, and existing-output rejection.
  Site integration: 4 tests passed, covering strict inputs/cardinality, new-directory
  preparation, generated consent lifecycle, cancellation, locale preservation, and
  protected project/schema APIs with synthetic authentication and real local D1.
  Six events were accepted; exact replay reported zero new events and six duplicates.
  Receipts remained six; workflow totals were two starts, one success and one failure.
- Root `node node_modules/typescript/bin/tsc --noEmit` passed. Contract checks:
  69 passed. `git diff --check` passed. The example CLI generated all eight expected
  files without remote calls, with collection disabled, registration unverified
  and privacy review false. Existing valid check results were reused for unchanged code.
- Delivery ZIP `tallyfin-sdk-231e2f38bcca.zip`: 37,553 bytes, SHA-256
  `7ee1281a9a15bfa08f08121b68f3afa273d8e039a440c3d299e2772be8e6db6b`.
  It contains 18 files: both tarballs, four source guides/input, SDK manifest,
  checksum list, eight generated example files, public connection settings and
  a start guide. Extraction verified all 17 listed file hashes, all SDK manifest
  hashes and the three disabled/unreviewed/unregistered fixture flags.
- A HEAD request to the public administrator origin returned 200. This establishes
  reachability only, not protected access, project registration or event delivery.
  No actual site ID/origin/language set was supplied, so no real site was registered.
  Publication still requires the existing operator authority and explicit privacy review.
- Updated the [roadmap](docs/product/01-roadmap.md) and added
  [independent-site guidance](docs/integrations/independent-sites.md). Existing API/DB
  and SDK signatures, dependencies, hygiene rules and CI/runner configuration are
  unchanged. No push, deployment, remote provisioning or npm publication. Full
  unrelated suites and remote registration/load tests were not rerun for this slice.

## Deployment revalidation — 2026-10-26

- Source commit `9f92c62` deployed Collector version
  `abecfc07-3648-4f4d-9159-abf351d00298` and administrator version
  `098a20ae-046f-4947-95cd-56037c1d8744` at 100% each. The authentication
  Worker was unchanged. Full evidence is in the
  [deployment revalidation record](docs/validation/2026-10-26-deployment-revalidation.md).
- The prepared bundle reused the existing production variables, D1 databases,
  service bindings and compatibility dates. The Cloudflare account remained on
  Workers Paid with the Standard usage model. The configured administrator build
  and both Worker deployment dry runs passed.
- The touched-row ingestion guard is deployed. The optional pre-D1 limiter code
  is deployed but inactive: no rate-limiting binding or required flag was
  configured, and no production namespace or threshold was selected.
- Administrative, authentication-health, JWKS, site and 8ailors surfaces returned
  HTTP 200. Unauthenticated identity access returned 401. These checks establish
  reachability and boundary behavior, not a successful login or protected read.
- A single login attempt with the stored initial credential returned 401. Login
  and protected-read revalidation were therefore incomplete. This observed
  condition is recorded as **stored initial credential rejected**; it is not
  classified as a service authentication regression. No password reset or change
  was performed.
- The actual administrator entry asset `/assets/index-CEJ0UHFT.js` returned
  HTTP 200 and its SHA-256 matched the prepared build. A cleanup revision advanced
  from 1175 to 1180 during observation; that is progress evidence, not proof that
  every cleanup operation succeeded.
- Both five-minute runs used four disposable projects sharing one D1, 20 events
  per batch (six complete three-step funnels and two page views), a replay on
  every fifth request, zero automatic retries, a 64-request client concurrency
  cap, and stop-on-failure behavior. Together they completed 8,400/8,400 HTTP
  200 responses, accepted 134,400 events and recorded 33,600 duplicates with no
  HTTP 503 or request failures.

| Target | HTTP | Accepted / duplicate | Client p95 / max | Max active | Response window | Requests/s | Accepted events/s |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| 12 requests/s, 300 s | 3,600/3,600 | 57,600 / 14,400 | 1,127.2165 / 2,223.9432 ms | 25 | 300,900.091 ms | 11.9641 | 191.4257 |
| 16 requests/s, 300 s | 4,800/4,800 | 76,800 / 19,200 | 1,216.4103 / 1,870.1588 ms | 29 | 300,378.1123 ms | 15.9798594 | 255.6777503 |

- Each 12 requests/s project retained 14,400 receipts and 14,400 events with
  4,320 funnel runs and all three step totals at 4,320. Each 16 requests/s project
  retained 19,200 receipts and 19,200 events with 5,760 funnel runs and all three
  step totals at 5,760. The eight load projects, four per phase, were paused
  before their integrity reads.
- The retained tails covered 2,387/3,602 (66.3%) and 2,664/4,802 (55.4769%).
  They observed 254 and 307 conflicts, zero exhaustions, maximum attempt 1, and no
  failed invocations. These are partial observations, not full censuses.
- Closeout confirmed all 10 projects paused, including the two probe projects,
  and no matching guard or Wrangler-tail process remained. The site, 8ailors and
  account-login surfaces returned HTTP 200, and the post-load version check
  retained both Workers at 100%.
- The load runs wrote synthetic test data only to those ten paused projects.
  Schema, migrations and resource bindings were unchanged. The load generator
  did not target `zerodi-site` or other existing production projects, and
  before/after row counts for those datasets were not compared. The record
  includes one authentication attempt with the stored initial credential, which
  returned 401; no password reset or change was performed.
- The completed pair extends the earlier verified 8 requests/s five-minute
  workload to 16 requests/s for the same single-client, four-project, one-D1
  conditions. It does not establish maximum capacity, an SLO, multi-region
  behavior or long-duration stability.
- Prior source results were reused because this documentation change includes no
  application-code change: Collector 202, installation/runtime checks 32,
  and type checks passed. The 69 contract checks passed again on 2026-10-26.
- Rollback is available through Collector
  `b6498981-83b7-4fd9-b736-404cf91e8f0c` and administrator
  `470beb08-390c-437a-aed4-7b9feb7ff411` without a schema or binding change. No API,
  DB schema, SDK, dependency, CI or authentication-Worker change is included.

## Optional pre-D1 browser request limiter — 2026-10-25

- Installation preparation and guided setup accept optional `collector.browserIngestLimit` with an explicit namespace ID, positive safe-integer request limit and a 10- or 60-second window. Omission preserves legacy target output. Selection generates `BROWSER_INGEST_LIMITER` and `BROWSER_INGEST_LIMITER_REQUIRED=true`; prepared-bundle revalidation rejects removed or altered protection.
- Required but missing bindings, invalid flags, malformed replies, failures, deadlines and cancellation return 503 before D1. Denied admission returns 429 with `Retry-After: 60` and no D1 operation. Server authentication ordering and administrator/maintenance paths remain unchanged.
- Browser preflight, a 20-event delivery and its replay each consume one limiter request; stored event counts and daily receipt usage remain 20, with three D1 minute admissions. A fourth, denied request performs no additional D1 batch. Limits count requests, including preflights and retries, rather than events.
- Focused runtime/configuration/installation tests: 32 passed. Entire Collector suite: 202 passed. Root `npm run typecheck`: passed. `npm run check --prefix tools/contracts`: 69 passed. `git diff --check`: passed. The generated definition was also accepted by the installed native Worker runtime in the focused tests.
- Updated installation/runtime guidance and roadmap. No API, DB schema, SDK signature, dependency, repository hygiene or CI/runner change. Full unrelated SDK/admin suites and remote load tests were not rerun for this bounded Collector/installation change.
- Cloudflare Rate Limiting is approximate and eventually consistent per location; this is not a strict global quota. Existing D1 project quotas remain authoritative. No production namespace or capacity value selected, infrastructure provisioned, push, publication or deployment performed; production activation and remote verification remain pending.

## SDK lifecycle, portable builds and ingestion state guards — 2026-10-25

- Local implementation: [design and verification](docs/validation/2026-10-25-ingest-state-guards.md).
- Browser delivery diagnostics: 4 passed. Generated browser/server setup: 10 passed. Browser SDK and integration gzip budgets passed unchanged.
- Ordinary administrator build passed from a tracked-source copy excluding `.openai` metadata, using the existing installed dependencies. Explicit Sites packaging and its combined Sites/bundle checks passed: 11 Sites tests and 2 bundle tests.
- Storage adapter suite: 88 passed; one subsequently added aligned existing-funnel race test passed separately (89 distinct cases). Collector/browser/server SDK integration: 21 passed. Root `tsc --noEmit` passed. Contract checks: 69 passed; `git diff --check` passed.
- Independent writers aligned at their initial read: both 4 and 16 requests committed on their first attempt, with respectively 4/16 snapshots, 4/16 write batches, and zero guard conflicts. This is a deterministic local concurrency test, not a throughput benchmark.
- Same-ID retransmission, an existing attempt's terminal transition, existing browser/server funnel linkage, live quota exhaustion, rollback, cancellation and publisher revocation remained protected. No API/DB schema, SDK signature, dependency or CI workflow changed.
- A file-based before/after comparison against `1e41884` used the same four-writer alignment harness: 10 snapshots + 10 writes and 6 conflicts before; 4 snapshots + 4 writes and 0 conflicts after. Both accepted 8 events. Database batch calls fell 60% (20 to 8) in this deterministic case, not a throughput benchmark. Query-plan inspection confirmed primary-key index lookups for receipts, attempts and live quota.
- Initial stdin-based auxiliary launches stalled and were stopped before successful file-based checks. Their processes were stopped; automatic approval review blocked removal of the ignored `.tmp/ingest-before-kr51DW` source copy without a detailed reason.
- No push, npm publication, infrastructure change, deployment or remote load rerun. The previous Paid capacity records describe the earlier deployment; 12/16 requests/s must be rechecked after deployment.

## Paid capacity closeout — 2026-10-25

The final distributed soak offered an aggregate 8 requests/s for 300 seconds
across four projects sharing one analytics D1. It completed 2400/2400 HTTP 200
requests with 38400 accepted events and 9600 duplicates over a
301.0166322-second response window. The client made no retries. Client p95/max
was 1608.941/3114.736 ms; maximum active concurrency was 15 and maximum
scheduler lag was 94.1995 ms. Observed completion and acceptance rates were
7.97298 requests/s and 127.5677 events/s.

Each project held 9600 receipts and 2880 funnel runs, with each of the three
funnel counts at 2880; the four-project total was 11520 funnel runs. The tail
retained 1825 of 2402 expected invocations (76.0%), with 299 conflicts, maximum
attempt 3, no exhausted retries, and no observed failed invocations. It is
partial and not a full census.

The verified comparison is 4 requests/s for five minutes on one project:
1200/1200 HTTP 200 with client p95 1401.805 ms. Distributed 12 and 16 requests/s
five-minute targets failed on one 503 each. The earlier 60-second distributed 16
requests/s pass (960/960, maximum active 42) does not establish sustainable 16
requests/s. The latest 8 requests/s run is a verified workload, not an absolute
maximum or SLO.

Cleanup SQL confirmed all 83 `verify-load-20261025-*` projects paused, with tail
process count 0; all nine program reports set `allProjectsPaused: true`. HEAD
requests to https://8ailors.xyz/ko/ and https://account.8ailors.xyz/ko/login
returned 200; this checks reachability, not real authentication.

Collector version `b6498981-83b7-4fd9-b736-404cf91e8f0c` remained at 100% with
`usage_model = 'standard'`; the Paid purchase was confirmed earlier.

Test-data writes and the account plan were authorized remote changes. No
application, API/DB/SDK contract, dependency, CI, CPU configuration, or new
deployment changed. Temporary drivers passed `node --check`. Full application
suites were skipped because application code was unchanged; 69 contract checks passed. Multi-region and
whole-service failover were not tested. Local commits were not pushed.

## Paid distributed sustained-load failures — 2026-10-25

Two five-minute distributed targets stopped on their first 503.

| Target | Attempts / planned | Responses | Accepted / duplicates | Response window | Observed completion rate |
| --- | --- | --- | --- | --- | --- |
| 16 requests/s for 300 s | 105 / 4800 | 104 HTTP 200 + one 503 | 1660 / 420 | 7.8114943 s | 13.442/s |
| 12 requests/s for 300 s | 1471 / 3600 | 1470 HTTP 200 + one 503 | 23520 / 5880 | 124.0459233 s | 11.859/s |

The rates use observed response windows, not the planned 300-second durations.
Both 503s were `storage_unavailable`. Exact request-ID correlation in the tails
matched each to a `commit`/`revision_conflict` failure exhausted at attempt 8.
The drivers stopped offering work on the first failure, drained in-flight
requests, paused all projects, and then read integrity.

No failed or partial event writes were found. Stored receipts matched stored
events, all three funnel aggregates matched, and both reports set
`allProjectsPaused: true`. Before and after probes returned 200; no sentinel
checks ran during load.

Tail coverage was partial: 90 of 107 expected invocations for the 16 requests/s
run and 747 of 1473 for the 12 requests/s run. Neither is a full census.

The source and deployed Collector version
`b6498981-83b7-4fd9-b736-404cf91e8f0c` were unchanged. Each run used four fresh
project IDs on the same analytics D1 database. These results supersede treating
the earlier 60-second 16 requests/s pass as sustainable capacity. An 8
requests/s five-minute follow-up is still running; this record does not include
its result.

## Paid distributed fixed-rate ingestion — 2026-10-25

The first distributed fixed-rate attempt on unchanged Collector version
`b6498981-83b7-4fd9-b736-404cf91e8f0c` used four separate disposable projects
that shared one analytics D1 database; it did not shard the database. The r4
phase passed 240/240 HTTP 200. The r8 phase stopped after 118 attempts: 117 HTTP
200 and one status 0 over a 15.363-second response window. No raw exception was
retained, so the network cause is UNKNOWN. Its failed batch stored zero events,
and this stop is not a server capacity boundary.

The manual fresh-project recheck's network-error capture adds only sanitized
name, code, causeName, and causeCode fields, with no message. The rerun used a
2000 ms scheduler-lag ceiling and a 64-request HTTP concurrency cap, with no
client retries. Its r8, r12, and r16 phases returned HTTP 200 for every request:

| Phase | Offered load | Responses | Client p95 / max | Response window | Scheduler max lag |
| --- | --- | --- | --- | --- | --- |
| r8 | 8 requests/s for 60 s (480 planned) | 480 / 480 HTTP 200 | 1794.447 / 2511.330 ms | 60.681 s | 1791.37 ms |
| r12 | 12 requests/s for 60 s (720 planned) | 720 / 720 HTTP 200 | 1489.835 / 2580.781 ms | 60.424 s | 100.36 ms |
| r16 | 16 requests/s for 60 s (960 planned) | 960 / 960 HTTP 200 | 1813.028 / 4050.729 ms | 61.271 s | 516.36 ms |

The r8 maximum lag stayed below the 2000 ms ceiling, but a short catch-up burst
is possible. The r12 and r16 maximum lags were 100.36 ms and 516.36 ms.

At 24 requests/s, the recheck stopped after 240 HTTP 200 and one HTTP 503 among
241 requests, over an 11.9078994-second response window. Tail correlation
attributes the 503 to a `commit`/`revision_conflict` failure exhausted at attempt
8. Its failed batch stored zero event IDs. The 32 requests/s phase was not run.

Each request used a 20-event batch with six complete three-step funnels and two
page views; every fifth request (20%) replayed the preceding body. Per-project
database assertions and all before/after probes passed, with no in-load sentinel
checks. Both reports set `allProjectsPaused: true`.

Tail coverage was partial. The first fixed-run tail retained 274 of 362 expected
invocations (75.7%); one additional soak-phase row was excluded from that count.
The recheck tail retained 1448 of 2409 (60.1%). Neither is a full census, and the
missing rows cannot establish the absence of other platform failures.

These runs did not change source or deployment. Temporary drivers passed
`node --check`. Application tests were skipped because application code was
unchanged. A new five-minute distributed soak at 16 requests/s is still running;
this record does not claim its completion or result.

## Paid single-project sustained ingestion — 2026-10-25

A five-minute, single-project target at 4 requests/s first stopped with
`scheduler_lag` after 849/849 HTTP 200 responses, with a 213.642-second response
window. The driver exceeded its 500 ms scheduler-lag ceiling, reaching 817.7 ms,
and stopped offering work. This was a client-generator interruption, not a
server failure.

The driver rerun raised the scheduler-lag ceiling to 2000 ms. The 32-request HTTP
concurrency cap and 15,000 ms timeout were unchanged, and no application code was
edited. Maximum scheduler lag was 126.06 ms. The rerun completed 1200/1200 HTTP
200 requests over a 300-second offered window (300.893-second response window),
with 19200 accepted events, 4800 duplicates, and 5760 funnel runs whose three
aggregate totals matched. Client p95/max was 1401.805/2642.787 ms, and maximum
active concurrency was 9.

Both reports set `allProjectsPaused: true`. Before and after probes returned 200;
there were no within-load sentinel checks. The tails were partial: the
interrupted run retained 679 of 851 expected invocations, and the completed
rerun retained 907 of 1202. Neither is a full census. The rerun tail recorded 246
conflicts, maximum attempt 6, no exhaustions, and no observed failed invocations.

Both runs used one Windows client in a single region. Each request carried a
20-event batch with six complete three-step funnels and two page views; every
fifth request replayed the preceding body. The client made no automatic retries.
The sampled client p95 is not an SLO. Four requests per second for five minutes
is a verified workload, not an absolute maximum. Distributed fixed-rate tests
are still running; their results are not included here.

Temporary driver scripts passed `node --check`. Application test suites were
skipped because application code was unchanged. The first slice passed 69
documentation contract checks.

## Paid capacity sweep and fixed-rate boundary — 2026-10-25

A fixed-rate sweep used one disposable project per phase on unchanged Collector
version `b6498981-83b7-4fd9-b736-404cf91e8f0c`. The 2 and 4 requests/s phases
completed their 60-second plans. The 6 requests/s phase halted on its first
failure and drained responses over a 9.773-second window. The reported 0.93
requests/s divides 56 requests by the full 60-second plan and is not observed
throughput. Observed throughput was 5.73 requests/s over the response window;
the short failed run is not sustainable capacity.

| Phase | Requested load | Successes / attempts | Client p95 / max | Response window |
| --- | --- | --- | --- | --- |
| r2 | 2 requests/s for 60 s (120 planned) | 120 / 120 HTTP 200 | 1643 / 2383 ms | 59.817 s |
| r4 | 4 requests/s for 60 s (240 planned) | 240 / 240 HTTP 200 | 1563 / 2929 ms | 60.197 s |
| r6 | 6 requests/s for 60 s (360 planned) | 55 / 56 HTTP 200 (one 503) | 3451 / 5578 ms | 9.773 s, halted |

A distributed sweep used four independent disposable projects per phase on the
same version; concurrency is aggregate across those projects. Concurrency 8, 12,
and 16 completed 128 / 128 HTTP 200. Concurrency 24 returned 127 / 128 and
halted, so concurrency 32 was not run.

| Phase | Requested load | Successes / attempts | Client p95 / max | Response window |
| --- | --- | --- | --- | --- |
| c8 | 4 projects, aggregate concurrency 8 (128 planned) | 128 / 128 HTTP 200 | 1243 / 1673 ms | 10.280 s |
| c12 | 4 projects, aggregate concurrency 12 (128 planned) | 128 / 128 HTTP 200 | 1762 / 7259 ms | 9.275 s |
| c16 | 4 projects, aggregate concurrency 16 (128 planned) | 128 / 128 HTTP 200 | 2631 / 6702 ms | 10.472 s |
| c24 | 4 projects, aggregate concurrency 24 (128 planned) | 127 / 128 HTTP 200 (one 503) | 2197 / 6116 ms | 6.361 s, halted |

Both reports set `allProjectsPaused: true`, and every integrity record was read
after pausing. Stored receipts matched stored events, aggregate and funnel
checks passed, and the failed batches stored zero event IDs. Both 503s were
`storage_unavailable`. Tail correlation matched each failure to the `commit`
stage with kind `revision_conflict`; one conflict sequence in each experiment
exhausted at attempt 8. The single-project
tail retained 272 of 422 expected invocations (416 load responses plus six
probes), or 64.5% coverage. It is incomplete and is not a full census, so it does
not establish that every uncaptured invocation passed. The distributed tail
retained 371 rows, also below the 520 expected invocations.

The drivers made no automatic retries and wrote to no production project, and no
requests targeted `zerodi-site`. A HEAD smoke of https://8ailors.xyz/ko/ and
https://account.8ailors.xyz/ko/login returned 200 for both. This checks public
reachability only and does not verify a real login. All measurements ran from a
single Windows client, not multiple regions.

These measurements did not change application code or deployment. Paid
allowances do not change compare-and-swap semantics, so revision conflicts remain
possible under contention. These bounded runs identify first failing points in
this sequence, not a general capacity or SLO guarantee. A five-minute
single-project soak and distributed fixed-rate tests are ongoing; their results
are not included here.

## Shared Cloudflare account and Workers Paid activation — 2026-10-25

An authenticated Cloudflare API listing placed `tallyfin-admin`, `tallyfin-auth`,
and `tallyfin-collector` alongside `zdp-web-apps-account-production`,
`zdp-web-apps-account-staging`,
`zdp-edge-workers-registration-production`,
`zdp-edge-workers-registration-staging`,
`zdp-comm-email-verification-production`, and
`zdp-comm-email-verification-staging` under exactly one account. Worker settings
confirm that the account UI uses a service binding to production email
verification, whose D1 database is distinct from the Tallyfin analytics and
Tallyfin auth databases.

The user authorized the upgrade and explicitly confirmed both the legal and
recurring-overage consent checkboxes. The official Cloudflare dashboard then
showed the purchase completed and a Workers Paid subscription active at $5 per
month, with usage overages.

After the change, Collector settings reported `usage_model = 'standard'`.
Active version `b6498981-83b7-4fd9-b736-404cf91e8f0c` remained at 100%, with
unchanged code and deployment. A remote `SELECT 1` succeeded after the earlier
D1 Free daily row-write exhaustion.

The scope is the account-level plan. It does not migrate Core or Money
PostgreSQL. Worker configuration, CPU limits, authentication, API/DB/SDK
contracts, dependencies, and CI are unchanged.

Exact account-wide usage and invoice totals are unmeasured. Shared Paid
allowances do not isolate billing or resolve revision conflicts. Next
measurements are ongoing; this record makes no claim about their results.

## Continuous-request contention boundary — 2026-10-25

A closed-loop generator kept eight requests in flight, immediately replacing
each completion, against one disposable project on unchanged Collector version
`b6498981-83b7-4fd9-b736-404cf91e8f0c`. It stopped offering new work on the first
failure and drained outstanding requests: 40 HTTP 200 responses and one 503
among 41 requests in a 5.808-second response window. Observed total completion
rate was 7.06 requests/s; this short failed run is not sustainable capacity.
Client p50/p95/max was 820/1875/3460 ms, with no client retries.

The 503 was `storage_unavailable`, correlated by request UUID with a `commit`
failure of kind `revision_conflict`. Tail captured an exhausted attempt eight,
57 total conflicts, no failed platform outcomes and all 43 load/sentinel
invocations. This differs from the prior platform CPU termination. A loop that
continuously replaces completed requests offers more load than synchronized
eight-request waves which wait for their slowest response.

Before integrity reads, the main project was paused through the control plane,
preventing later guarded writes. D1 held exactly 640 receipts/events and 192
complete funnels with reached totals `[192,192,192]`; per-event aggregates
matched stored synthetic IDs, and the failed batch's 20 IDs were absent.
Independent-project probes before and after load returned 200. Both disposable
projects were paused and the tail process was stopped. No requests targeted
`zerodi-site`. Higher single-project concurrency was not attempted after the
failure. Next measurements separate fixed-rate single-project capacity from
higher concurrency distributed across independent projects.

Only verification records changed. No application, API/DB/SDK contract,
dependency, CPU limit, retry budget, CI runner or deployment changed. Temporary
drivers passed Node syntax checks; application tests are not repeated for an
unchanged deployment.

## Deployed verification after CPU reduction — 2026-10-25

Collector version `b6498981-83b7-4fd9-b736-404cf91e8f0c` was deployed and
verified active at 100%. All 1456 post-fix load requests returned HTTP 200 with
no client retries: 256 requests at concurrency eight, followed by a separate
600.01-second, 1200-request trial with four-request bursts every two seconds.
These are bounded experiments, not a maximum-capacity or production SLO claim.

| Post-fix workload | Responses | New receipts | Duplicates | Client p95 / max |
| --- | ---: | ---: | ---: | ---: |
| Concurrency eight | 256/256 HTTP 200 | 4480 | 640 | 2068 / 2577 ms |
| Ten-minute main project | 1180/1180 HTTP 200 | 18880 | 4720 | 1502 / 2486 ms |
| Ten-minute independent sentinel | 20/20 HTTP 200 | 20 | 0 | 791 / 794 ms |

Independent D1 assertions matched receipts to event aggregates. The concurrency-
eight project's three funnel totals were `[1344,1344,1344]`; the sustained main
project's totals were `[5664,5664,5664]`. Its ten one-minute windows all passed,
with a maximum schedule lag of 490 ms. Maintenance revision advanced from 808
to 818. No large expiration backlog was injected. The sustained tail captured
1201 test-prefix invocations including its 404 canary, 550 revision conflicts,
maximum failed attempt three, no exhausted retries and no failed invocation
outcomes. The concurrency-eight tail captured 247 invocations, 471 conflicts,
maximum failed attempt six and no exhaustion or failed outcomes; that capture
is incomplete and is not a full census of conflicts.

The exact failed synthetic batch from the CPU reproduction was manually
resubmitted after deployment: accepted 20/duplicates 0, then accepted
0/duplicates 20 on the identical replay. Main-project receipts and event totals
rose from 11000 to 11020 exactly once, and all three funnel totals rose from
3300 to 3306. The earlier sentinel retained 12 receipts. All six disposable
projects from this investigation were paused; no requests targeted `zerodi-site`.
Tail process trees were stopped by their owners.

Repository type checking, 69 contract checks, 57 core tests, 32 focused
storage/calendar tests, eight diagnostic tests and four benchmark helper/pool
tests passed. Counts overlap and are not additive. Full unrelated frontend and
backend regression suites and maximum-capacity/multi-region tests were not
repeated. There is no generic lint command. HTTP/DB/SDK contracts, dependencies,
CI runners, CPU limits and subscription settings are unchanged. Updated source
and operational records are committed; no SDK version or npm release is needed.

## Reproduced platform CPU termination and ingestion CPU reduction — 2026-10-25

The instrumented four-request trial reproduced a failure after 349.22 seconds:
699 HTTP 200 responses and one HTTP 503 among 700 requests. The failed response
was `admin_api_unavailable` with `Retry-After: 5`, not a Collector
`storage_unavailable` response. The sanitized Collector tail captured one
`exceededCpu` invocation, whose only app log was a non-exhausted revision
conflict at attempt one. It captured no exhausted retries. All 20 event IDs
from the failed synthetic batch were absent from D1. Both trial projects were
paused in cleanup. This identifies the reproduced failure path as platform
CPU termination propagating through the service binding; historical failures
without retained response evidence are not individually attributed.

Ingestion now retains one validated configuration fingerprint per store. Each
fresh DB snapshot still checks every configuration field and uses the original
transactional revision guard. Identical configuration skips repeated parsing,
schema validation, cloning and canonicalization. The expected fingerprint is
computed once per commit, and caller mutations cannot alter the retained
fingerprint. Any changed configuration is validated again. Time-zone validation
reuses the existing bounded formatter cache. No I/O promises, permissions or DB
snapshots are cached; retries, CPU limits and subscriptions are unchanged.

A local synthetic comparison of 250 rounds with four commit attempts each
reduced full configuration validations from five to one per round. Measured
process CPU was 953 ms before and 157 ms after; elapsed time was 933.45 ms and
149.54 ms. This isolates local validation/comparison work and is not a remote
per-request CPU or throughput measurement. Focused storage/calendar tests passed
32/32; all 57 core tests passed (overlapping scopes, not additive).

The local collector benchmark now retains allowlisted error codes, valid
request UUIDs, bounded Retry-After seconds and timing for received failures,
including malformed-JSON status evidence. Four benchmark helper/pool tests and
eight diagnostic/observation tests passed. Classifications distinguish CPU or
memory limits and storage timeouts from generic database resets. Deployed
verification of the CPU reduction is recorded above. API/DB contracts, SDK,
dependencies, runner and deployment limits are unchanged.

## Bounded collection failure diagnostics — 2026-10-25

The previous deployed failures cannot be attributed from retained evidence:
the soak observer kept conflict totals but not individual invocations, and the
client omitted failed response codes and request IDs. The Collector now emits
one additional diagnostic on a server failure, containing only the request ID,
a fixed execution stage and a fixed cause category. Exception text, SQL, event
data, project IDs and credentials are excluded. Cause traversal stops after six
errors and handles cycles. This adds no retries or changes to HTTP responses.

Eight focused diagnostic/observation tests, repository type checking and all
69 contract checks passed. Tests include nested causes, cyclic causes, failing
observers, phase attribution, request-ID correlation and private-data exclusion.
API/DB contracts, dependencies, SDK and CI are unchanged. Root-cause reproduction
and deployed verification remain pending; diagnostics alone do not fix the 503.

## Extended deployed ingestion trial — 2026-10-25

**Result: failed the zero-error experiment guard.** A planned 600-second run
stopped after 518.57 seconds (about 8 minutes 39 seconds) when one request
returned HTTP 503. There were 1039 HTTP 200 responses among 1040 requests, with
no client retries. Neither this partial run nor the separate concurrency-8
failure establishes a passing sustained-capacity or operational SLO claim.

The load generator offered four-request bursts every two seconds, capped at
four actual in-flight requests and 1200 total planned requests. Every 60th
request was a single page-view event to a second disposable project. Of the
remaining main-project requests, every fifth replayed the preceding new
20-event batch. No requests were sent to `zerodi-site`. The main project alone
used a 25000-receipt test allowance; existing production project limits,
authorization and definitions were not modified.

The generator awaited each burst, recorded schedule lag and stopped rather
than accumulating an unbounded backlog. Experiment guards were any non-200,
transport error or invalid receipt, per-minute p95 >= 5000 ms, and start lag
>= 2000 ms. Each request retained a 15-second timeout and the whole run had a
660-second watchdog. The recorded maximum start lag was 628 ms. These guards
are test controls, not newly adopted production SLOs.

| Measured result before the stop | Value |
| --- | ---: |
| Requests / successful responses / HTTP 503 | 1040 / 1039 / 1 |
| Overall client p50 / p95 / maximum | 656 / 1462 / 2606 ms |
| Main-project requests / successful requests | 1022 / 1021 |
| Independent-project sentinel requests / successful requests | 18 / 18 |
| Main-project acknowledged and stored new events | 16340 |
| Acknowledged duplicates | 4080 |
| Main-project completed funnel runs | 4902 |
| Independent-project acknowledged and stored events | 18 |

The eight complete 120-request reporting windows all returned HTTP 200. Their
p95 values were 1278, 1402, 1833, 1239, 1304, 1508, 1580 and 1376 ms. There was
no steadily increasing latency trend in these samples. This is not a direct
measurement of server memory, CPU or leaks. The final partial window contained
the failure; its absence from those eight complete windows must not be hidden.

Independent D1 queries verified that the main project's receipts and event
aggregate both equalled 16340, its funnel-run count equalled 4902 and its three
funnel reached totals were `[4902,4902,4902]`. Sentinel receipts and event
aggregate both equalled 18. The one failed fresh 20-event batch was not stored;
there is no claim of successful delivery or recovery for it. Successful writes
and replays therefore matched the stored totals without a partial aggregate
or duplicate inflation. Client retries were intentionally disabled, so SDK
recovery of this specific failure was not tested.

A tail observer attached after the run began. Its incomplete capture contained
872 test-prefix invocations (including a deliberate unknown-project 404 canary),
911 reported revision conflicts, no observed retry exhaustion, and a maximum
observed failed attempt of three. Eight observed maintenance invocations fell
within the trial interval; all completed four project cleanup operations with
zero reported failures and advanced their cursor. No large expired-data cleanup
was injected. These observations do not attribute this 503: it must not be
assumed to have the earlier three-attempt exhaustion cause. Future diagnosis
needs the failure's precise request/phase and bounded cause category.

All three new trial projects (the sweep, soak and sentinel) were confirmed
paused. The sweep had 620 receipts; soak/sentinel counts are above. The tail
process tree was explicitly stopped after load completion and its sanitized
summary preserved. The Collector active version was verified unchanged at
`7fd27677-928c-4120-a3c0-f82e86f1bb63` before and after the experiment. No code,
API/DB contract, permissions, deployment configuration, dependency, CI/runner
or repository hygiene policy was changed for this work.

Local evidence: `.tmp/contention-sweep-failure.json`,
`.tmp/contention-soak-failure.json`, `.tmp/contention-soak-progress.json`,
`.tmp/contention-soak-projects.json`, `.tmp/contention-soak-final-check.json`,
`.tmp/contention-soak-partial-integrity.json` and
`.tmp/contention-soak-observer.json` and `.tmp/extended-load-cleanup.json`.
Syntax checks, `git diff --check` and 69/69 contract/link checks passed. The
application's unchanged typecheck/unit/browser/build suites were
not repeated for this experiment-only and documentation-only work.

## Higher-concurrency capacity boundary — 2026-10-25

A bounded sweep against deployed Collector version
`7fd27677-928c-4120-a3c0-f82e86f1bb63` started at concurrency 8, with
32 new 20-event batches and no client retries. It returned 31 HTTP 200 and
one HTTP 503; p50 was 1101 ms, p95 3217 ms and maximum 3489 ms.
The disposable project accepted 620 events and was paused in finally.
The sweep stopped at this first failing phase; concurrency 12 and 16 were
not run. This is a failed higher-concurrency sample, not a passing capacity
claim. Tail did not establish a connection within its startup guard, so this
particular 503 has no captured internal-cause attribution.

A separate 10-minute trial used the previously passing concurrency 4 and a
1200-request ceiling, including a separate-project sentinel. It stopped on a
503 after 518.57 seconds and 1040 requests. The full ten-minute window was not
completed; details below do not erase either failing sample.

Local sweep evidence: `.tmp/contention-sweep-failure.json` and
`.tmp/contention-sweep-project.json`. No code, configuration, schema or
permission policy changed; the only remote data written belongs to the
new disposable verification project.

## Bounded ingestion contention recovery — 2026-10-25

The earlier concurrency-4 HTTP 503 was investigated with an unchanged retry
policy plus narrowly projected diagnostics. Four real local D1 writers were
aligned after each consistent snapshot: exactly three committed and one
exhausted all three attempts. The named SQL revision guard rolled back the
losing write batches; the store immediately retried without backoff and stopped
before the fourth writer could obtain a fresh successful turn.

A diagnostic-only Collector version (`ee55d133-dda6-4f7a-be81-720b7510d833`)
then reproduced the same failure on the deployed service-binding path. Of
16 new 20-event batches at concurrency 4, 14 returned 200 and two returned 503.
Tail captured all 16 invocations, 12 named revision conflicts and two exhausted
third attempts. Each 503 invocation contained its own exhausted-third-attempt
log. The invocations themselves finished normally: these were handled storage
errors, not Worker crashes. The historical single 503 lacked this diagnostic;
its original log is not being retrospectively claimed as proof.

The fix retains cross-instance DB CAS and atomic batches. Only the named
`tallyfin_ingest_revision` guard failure is retried, after a fresh consistent
snapshot and recomputation. D1's documented [batch rollback semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
make these specific failed writes safe to retry. Other database failures are
not retried, and the original error remains the cause on exhaustion.

- Maximum attempts: 3 → 8, including the initial attempt. Full jitter uses
  exponential ceilings of 20, 40, 80, 160, 250, 250 and 250 ms. Configured waits
  sum to at most 1050 ms; this excludes DB latency and timer scheduling delays.
- Uncontended requests add no sleep or DB call. Worst-case contended work is
  bounded at eight snapshot/write pairs (16 DB batches instead of six), so the
  change trades bounded additional work for recovery rather than hiding an
  unlimited queue or retry loop. It does not serialize through process memory.
- The existing request AbortSignal is supplied to the store. Abort before or
  during waiting removes the timer/listener and prevents another snapshot or
  write. The existing 15-second total request deadline is preserved.
- Optional signal/randomness and diagnostic callbacks preserve existing
  constructor arguments and required collection signatures. Conflict logs
  contain only a fixed event name, attempt number and exhaustion flag, without
  SQL, event content, project IDs or credentials. Diagnostic sink failure is
  ignored without altering the request result.

The fixed Collector version is `7fd27677-928c-4120-a3c0-f82e86f1bb63`.
The deployment preserved the verified account/DB binding, vars, compatibility
flags, private ingress and empty Cron configuration. Auth/admin were not
redeployed and no DB migration, API shape, SDK, dependency, hygiene or CI change
was required.

| Remote phase, concurrency 4 | Requests | HTTP 200 | Accepted | Duplicates |
| --- | ---: | ---: | ---: | ---: |
| Four rounds of new batches | 64 | 64 | 1280 | 0 |
| Replay of an accepted batch | 16 | 16 | 0 | 320 |
| Identical new-batch race | 8 | 8 | 20 | 140 |

All 88 requests passed without client retries. D1 independently confirmed 1300
receipts, 1300 event increments and funnel reached counts `[390,390,390]`.
New-write phase p95 ranged from 1128 to 2064 ms (16 samples per phase); this
change does not claim faster tail latency. The post-fix tail captured 54 of the
88 requests, with 21 observed conflicts, no observed exhaustion and a maximum
observed failed attempt of three; those log counts are not a complete conflict
census. The HTTP results and DB assertions cover all 88 requests.

Both disposable trial projects were verified paused. Their receipt/event counts
were 280 (baseline) and 1300 (fixed). `zerodi-site` was not the load target and
its definitions/permissions were not changed. No persistent tail process was
left running. This bounded trial establishes recovery at the tested concurrency;
sustained capacity, higher concurrency and an operational SLO remain unverified.

Validation: 34/34 focused storage/retry/dependency tests and 29/29 runtime,
admission and funnel tests passed; typecheck, 69/69 contract checks and selected
production-config dry-run passed. Tests cover four aligned actual D1 writers,
exhaustion/cause preservation, zero retries for unrelated DB errors, cancellation
without later I/O, jitter bounds, timer/listener cleanup, daily quotas and
publisher access. The unchanged broad full suite and browser UI journeys were
not repeated. `git diff --check` passed.

Local evidence: `.tmp/contention-baseline-failure.json`,
`.tmp/contention-baseline-tail.json`, `.tmp/contention-fixed-report.json`,
`.tmp/contention-fixed-tail.json` and `.tmp/contention-project-cleanup.json`.

## Production load and database recovery — 2026-10-25

The manual remote trial used the deployed administrator-to-Collector service
binding and production analytics D1, with fresh disposable projects and a
reserved `.invalid` allowed origin. It did not send load events to `zerodi-site`.
Both trial projects were confirmed paused after execution. No production schema,
authorization grant, Worker binding, dependency or CI configuration changed.

| Closed-loop phase | Concurrent requests | Requests | HTTP 200 | Accepted | Duplicates | Client p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| New batches | 1 | 16 | 16 | 320 | 0 | 1430 ms |
| New batches | 2 | 16 | 16 | 320 | 0 | 1212 ms |
| Identical replay | 2 | 16 | 16 | 0 | 320 | 1322 ms |
| Identical new-batch race | 2 | 8 | 8 | 20 | 140 | 455 ms |

All 56 requests used 20-event batches without client retries. D1 independently
confirmed 660 receipts, 660 event-count increments and funnel reached counts
`[198,198,198]`. Thus 460 duplicate submissions added no receipts or aggregates.
These are small closed-loop samples measured from one Windows client, including
network latency; they are not a sustained-throughput limit or production SLO.
The 5-second p95 stop threshold was an experiment guard, not an adopted SLO.

**Observed failure:** the preceding sweep succeeded for 16 requests each at
concurrency 1 and 2, then returned 15 HTTP 200 and one HTTP 503 at concurrency 4.
The trial stopped before its replay phase; its paused project has 940 receipts
and 940 event-count increments. This is a failed capacity sample. It must not be
replaced by the later passing concurrency-2 result. The store retries a named
`ingest_revision` conflict at most three times and then returns 503, but the
response alone does not establish whether this caused the observed failure.
Internal cause attribution, higher concurrency and sustained load remain open.

Production analytics and Better Auth databases were exported separately, saved
as AES-256-GCM archives, read back and decrypted, and imported into two newly
created remote D1 databases. Full schema/table fingerprints matched their
respective exported snapshots; `quick_check` and foreign-key checks passed.

| Database | Application/migration tables | SQL export bytes | Export | Import | Total drill |
| --- | ---: | ---: | ---: | ---: | ---: |
| Analytics | 18 | 451454 | 3.37 s | 7.59 s | 21.78 s |
| Better Auth | 14 | 22154 | 2.67 s | 10.00 s | 17.33 s |

The restored analytics snapshot contained 965 receipts. Replaying seven existing
events returned `{accepted:0,duplicates:7}` and preserved its fingerprint;
an immutable-schema update was rejected. The backup preceded the final load
trial, so its receipt count differs from the later live DB. Both temporary
restore databases were deleted, with a subsequent account inventory confirming
none remained. Production databases were not overwritten or rebound.

Encrypted backups and their report remain under
`%LOCALAPPDATA%/Tallyfin/Backups/recovery-20261025-*/`; the key is protected by
Windows DPAPI CurrentUser and the directory ACL is restricted to that account.
The successful backup directory contains no plaintext SQL or private import log.
This proves recovery on this Windows account, not recovery on another device.
It does not establish automatic backup cadence, an RPO, whole-service failover,
restored application login or a guaranteed RTO. Whole-service recovery must also
restore configuration, signing secrets and bindings, and exercise sign-in.

The local `bench:collector` and `verify:restore` drills also passed: 1090 receipts,
480 completed workflows and 24 completed funnels in the former, and all 17
fixture tables, deduplication, protected writes and integrity in the latter.
Two verifier defects were fixed: native `cloudflare:workers` imports must remain
external in esbuild test/local bundles, and recovery fingerprints must include
mixed-case Better Auth table names. No runtime API or DB contract changed.

Additional regression verification and tool changes:

- `npm run typecheck`: passed. `npm run check --prefix tools/contracts`: 69/69
  passed. Focused benchmark tests passed 2/2; recovery-fingerprint tests passed 3/3.
- The initial broad `npm test` run had 568 passes, 17 failures and six timeout
  cancellations. Native Worker bundling and stale pre-0014 migration/table
  expectations were corrected; migration behavior itself was not changed.
- The bounded run used the now-default `--test-concurrency=2` with the existing
  30-second per-test limit: 590 passed, zero failed and one timed out. That native
  publisher Worker test still initialized its new database through 68 separate
  calls. Changing this fixture to one transactional batch made its focused rerun
  pass in 10.73 seconds without increasing the timeout. The full 591-test suite
  was not repeated after that final fixture fix; these results are not a claim
  of a single completely passing final full-suite run.
- Default test file concurrency is now capped at two, and local/test esbuild
  bundles preserve the native Workers import. No new CI job or schedule was
  added. No SDK release, application redeployment or disruptive live failover
  was performed for these validation-tool changes. `git diff --check`: passed.

Local reports: `.tmp/remote-load-report.json`,
`.tmp/remote-recovery-report.json`, `.tmp/remote-recovery-cleanup.json`.
The encrypted backup directory also contains `archive-format.json`, documenting
nonce/tag layout and DPAPI protection without including a plaintext key.

## Deployed site action funnels — 2026-10-25

[Schema 2](examples/0disoft/registry-v2.json) adds six browser action events and
two ordered funnels to `zerodi-site`. Schema 1 remains active and unchanged for
older tabs. The trusted provisioner applied the reviewed schema before site
rollout. Existing page-category/language enums are reused; seven event types
each have at most 42 combinations and each funnel has six language groups.
No new administrator grants, publisher identities or credentials were needed.

- `story_sharing`: story opened → copy attempted → clipboard helper succeeded.
  One run per consented story navigation; failure/retry preserves the first
  attempt milestone and does not invent success. Native share-sheet success
  and external social links are not treated as copied links.
- `search_discovery`: 160 ms debounced search executed → result clicked in the
  current tab → navigation completed to that exact path. New queries invalidate
  previous selections; different destinations and new tabs do not complete it.
- The browser keeps random task contexts only in tab memory, never cookies or
  persistent browser storage. A path used to match navigation stays local.
  Only finite `section`/`locale` properties are transmitted, along with the
  existing SDK task envelope. Search text, URLs, titles, slugs, clipboard
  contents and visitor identities are excluded. Language is fixed at run start.
  Withdrawal destroys delivery and contexts and invalidates late completions.

Site commit `7869f3f15d194e52fea4903e119fa875d31b3ce6` implements the hooks,
privacy wording in six locales, tests and a reusable browser action journey.
[Pages run 40180453609](https://github.com/0disoft/0disoft.github.io/actions/runs/40180453609)
succeeded. No extra CI job, schedule or deployment workflow was added.

- All 153 site tests across 26 files passed, including copy failure/retry,
  once-only completion, navigation/withdrawal/reconsent races, rejected starts,
  search invalidation, unique run IDs and mismatched destinations. Svelte check
  reported 0 errors and warnings; lint, formatting, six-locale validation and
  production build/index passed (828 indexed pages). The existing CI checks
  also passed against the pushed commit.
- The isolated Chromium action journey passed using real Pagefind navigation
  and native clipboard success, followed by forced failure of both clipboard
  paths on a new story. It observed 11 events, two complete runs and one copy
  run without success. It intercepted collection and made no remote writes.
- The same journey passed on the deployed site in Chromium 156.0.8078.4. All
  11 tested event IDs were present in remote D1 receipts. The three stored run
  states had reached flags `[1,1,1]` (search), `[1,1,1]` (copy success) and
  `[1,1,0]` (copy failure). Aggregate deltas were search `[1,1,1]` and copy
  `[2,2,1]`. Before consent and after withdrawal, requests were zero; page
  errors were zero. Unrelated Google/advertising requests were blocked.
- Replaying the seven-event action batch returned HTTP 200 with
  `{accepted:0,duplicates:7}` and left aggregate rows unchanged.
- The first live journey reached the same milestones, but its harness waited
  for one browser response notification per request and timed out. The SDK
  cancels response bodies; Chromium can report `net::ERR_ABORTED` and omit a
  response notification even after D1 has accepted the batch. The corrected
  harness requires observed statuses to be 200 and verifies every event ID,
  stored ordered run state and aggregate delta directly. The additional live
  journey left cumulative counts search `[2,2,2]`, copy `[4,4,2]`. These include
  intentional test failures and are not organic traffic conversion rates.
- The existing signed-in administrator selected schema 2 after refresh. In
  Goals, both funnel definitions were visible. Authenticated reads displayed
  cumulative copy as 2/4 completed (50%) and search as 2/2 (100%), matching
  the remote state. No credential was read from the tab.

The 69 contract checks passed, including changed documentation links; these
checks do not execute Collector or auth runtime behavior.

Ignored evidence is `.tmp/0disoft-actions-live-report.json`, its input snapshot,
and `.tmp/0disoft-actions-live.png`. Source-of-truth updates are the example
registry/README, product spec, roadmap, workspace boundaries and this record.
No analytics API or logical DB contract, runtime Worker, migration, dependency,
repository hygiene or runner count changed. No npm publication or Tallyfin
redeployment was necessary. The unchanged full Tallyfin runtime suites were
not repeated; actual deployed ingestion, D1 state and authenticated analysis
were tested. This does not establish server-side business completion, actual
social posting, unique people, production load/SLOs or remote backup/recovery.

## First deployed service pilot: 0disoft.github.io — 2026-10-25

Registered project `zerodi-site` with the reviewed schema 1 in
[the pilot registry](examples/0disoft/registry.json), `Asia/Seoul`, the single
allowed site origin and bounded ingest limits. The trusted offline provisioner
applied the registry and the existing administrator's owner grant; no password,
token, cookie or signing secret was copied into the site. The existing public
batch route works through the administrator Worker and private Collector binding.
Allowed-origin OPTIONS returned 204 and a foreign origin was rejected.

Site commit `633696daddb47755df67f280c4b4c17413371d0b` installed the licensed local
browser-SDK archive and connected consented navigation tracking. Only `page_view`
with fixed `section`/`locale` enums is sent, at most 42 combinations. No URL,
query, title, article slug, search text or visitor identifier is included in event
properties. The SDK omits credentials/referrers; withdrawal destroys pending work.
Privacy wording was updated in all six locales. The existing Pages workflow
received one public environment variable, without adding jobs or scheduled runs.

- Site checks passed: 147 tests across 26 files, Svelte check with 0 errors and
  0 warnings, lint, formatting, six-locale validation, production build and
  Pagefind index (828 pages). A first simultaneous check/build collided on the
  type-generator lock; sequential checking after build passed.
- The isolated Chromium check passed Tallyfin-only consent, exactly one initial
  page view, credential/referrer omission and no delivery after withdrawal.
- [GitHub Pages run 40179440744](https://github.com/0disoft/0disoft.github.io/actions/runs/40179440744)
  succeeded, including its existing checks, build and deployment. The deployed
  public env endpoint contains the reviewed collector URL. The Apache LICENSE
  and NOTICE are also served successfully under `/licenses/tallyfin/`.
- Chromium 156.0.8078.4 then visited the real site with a fresh context. Before
  consent, collection requests were 0. After consent, home and investors sent
  two one-event batches, each returning HTTP 200. Both receipts were read back
  from remote D1. Aggregates increased from home=1 to home=2/investors=1.
- Replaying the first batch returned `{accepted:0,duplicates:1}`. Aggregates
  remained home=2/investors=1 and the two tested receipts remained exactly two.
  After withdrawing consent and navigating to creators, additional collection
  requests were 0. Page errors were 0. Unrelated Google/advertising requests were
  blocked in the test browser so synthetic pilot visits were not sent to them.

The pre-existing home=1 came from the first live harness attempt: collection
returned 200, but reading a response body already cancelled by the SDK failed.
The corrected harness checks HTTP status and stored receipts rather than trying
to consume SDK-owned bodies; its retry and remote aggregate checks passed.
The ignored report and screenshot are `.tmp/0disoft-pilot-live-report.json` and
`.tmp/0disoft-pilot-live.png`. These are real accepted page views, including the
initial harness visit; they are not claimed to be unique human visitors.

No analytics API/DB contract, runtime Worker code, migration or runner count
changed. No npm publication or Tallyfin redeployment was needed. The unchanged
full Tallyfin analytics suites were not repeated; the real ingest/aggregate path
and site checks were verified directly. This pilot does not establish server
publisher authentication, task/funnel completion, mobile runtime cost, production
load/SLOs, remote backup/recovery or another product's integration. README,
product spec, roadmap, workspace boundaries and this record reflect that scope.

## Development dependency security updates — 2026-10-25

Updated only two vulnerable transitive packages, preserving their existing major
versions and future compatible updates:

- `undici` 7.30.0 → 7.30.1 in the root lockfile; raised the existing override
  minimum to `^7.30.1`. This fixes the development-only Miniflare/Wrangler path
  reported in [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c).
- `fast-uri` 3.1.8 → 3.1.9 in the independent contracts-tool lockfile, within
  AJV's existing range. This fixes Dependabot alerts 4–7, covering scheme
  injection, host confusion, relative-path equivalence and encoded schemes.
  See [the upstream advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg).

Root, contracts and browser-bench `npm audit` each reported 0 vulnerabilities.
`npm ls` confirmed the fixed installed versions and expected dependency paths.
Auth/Workers runtime tests passed 6/6, including real local D1, native Worker
password changes and Durable Object maintenance. Contracts passed 69/69, Redocly
OpenAPI lint passed, and `git diff --check` passed. No package was force-upgraded
and no unrelated dependency changed.

Typecheck and the full analytics/UI suites were not repeated because the only
code-package changes are these two development-tool patches; their affected
runtime and schema tools were exercised directly. No production application,
API, DB, CI runner or repository hygiene setting changed, so no production
redeployment was performed. This validation record is the only document updated.

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
