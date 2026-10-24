# Tallyfin prototype design QA — 2026-10-08

final result: passed

## Comparison target and evidence

- Source visual truth: `docs/frontend/assets/project-overview-selected.png` (1487 × 1058).
- URL: `http://127.0.0.1:5180/`, Codex in-app browser.
- State: ModuFile / overview / 7 days / normal / scroll at top.
- CSS viewport: 1487 × 1058; browser reports devicePixelRatio 0.9.
- Raw browser screenshot: `.tmp/prototype-qa/desktop-final-raw.png` (1633 × 1174). The capture includes extra blank browser canvas outside the CSS viewport. Comparison crops that canvas to 1487 × 1058; no page rescaling.
- Implementation screenshot: `.tmp/prototype-qa/desktop-final.png` (1487 × 1058).
- Full side-by-side: `.tmp/prototype-qa/comparison-final.png` (2974 × 1058), source left / implementation right. Both were opened together for comparison.
- Focused captures: `.tmp/prototype-qa/comparison-header.png` and `comparison-table.png`. Typography, controls, KPI separators, logo, table header and rows were inspected in these comparisons.
- Responsive evidence: `.tmp/prototype-qa/mobile-overview.png`, `mobile-drawer.png`; tested CSS widths 320 and 390. Temporary viewport override was reset afterwards. Screenshots are local ignored evidence, not production source.

## Findings and iteration history

1. **P2 — Vertical spacing pushed the event table down.** Initial capture `comparison-before.png` showed a taller chart, excessive gaps and the final table row below the viewport. Reduced chart height and section gaps; changed table-header margin and metric padding. Final full and table captures show all four rows with the intended flat table structure. The extra accessible **View values** control accounts for the remaining small offset.
2. **P2 — Table count alignment and legend drift.** Initial counts sat at the far right and the legend used a bar icon. Counts now align at a stable 72% first-column boundary in overview, and the legend uses a blue circle from Phosphor. Other analytical tables retain right-aligned numbers.
3. **P2 — Mobile horizontal overflow.** A tooltip retained its desktop coordinates on resize, expanding document width to 780px. Chart overflow is now contained, and native details use block layout. At CSS 320px and 390px, document width is within the viewport; the event table scrolls inside its own container (271px client / 540px contents at 320px).
4. **P1 — Period-dependent fixture counts.** Overlapping dates changed when selecting 14 versus 30 days. Fixtures now use a stable calendar index; a regression test checks identical overlapping records for all projects. This was a data-correctness issue rather than a source-visual mismatch.
5. **P2 — Unknown goal rendered a zero progress bar.** Empty goal data now omits the progress indicator and displays an unknown rate rather than implying 0%.

Post-fix captures were reopened in full-view and focused comparison. No actionable P0/P1/P2 differences remain for this sample prototype.

## Required fidelity surfaces

- **Fonts and typography:** Inter / Noto Sans KR, title 44px, desktop KPI 56px, body/table/chart 16–18px, mobile title 32px and KPI 34px. Korean font CSS includes Unicode subsets. Hierarchy, numeric weight and line breaks follow the selected visual; exact generated-image typeface is unknown. Initial documented font sizes were candidates, not final limits.
- **Spacing and layout rhythm:** 250px fixed sidebar, open four-column metrics with hairlines, wide chart and flat table. Mobile uses a drawer and two-column metrics. No card grid or nested surfaces were added to overview.
- **Colors and tokens:** white main area, #F8FAFC navigation, #155EEF emphasis, #0F172A text, #64748B secondary text, #E2E8F0 hairlines. Active navigation and focus states are visible. Slight source background shading is intentionally replaced with flat surfaces.
- **Image quality:** generated transparent blue fin raster is sharp at 40 × 30, with no visible white rectangle on the sidebar. Standard icons use Phosphor; charts use Recharts. No handcrafted asset substitute.
- **Copy/content:** sample project names, headings, metric labels and event names match the chosen overview. The displayed totals and denominator match the reference. Chart values deliberately sum to the total rather than reproducing the reference's inconsistent illustrative line. Fixed sample date and static KST label avoid implying a live clock or functional timezone selector.

## Interaction verification

- Project switching: ModuFile, Sembom and Orchid Pass update labels, metrics and event definitions. Settings names reset independently when switching projects.
- Periods: 7, 14 and 30 update totals and chart; 7-day ModuFile has 24,680 total, 4,800 starts, 4,128 successes, 96 errors, 3,560 downloads, 86.0% (4,128 / 4,800).
- Events: search, empty result, reset, name sorting, count sorting, row selection and event-specific chart. Initial text-entry simulation conflicted with the input method; actual text selection/paste confirmed settings editing without changing application code for the browser tool.
- Settings: saved a changed name, rejected a whitespace-only name with field error, reset to the default, and confirmed another project's default stayed intact. Values are memory-only.
- States: loading, empty, error, unauthorized and stale display correctly; retry and refresh restore normal state. Empty rate is “—” with 0 / 0 context.
- Mobile: drawer open/close, Escape, navigation and project switching; event table stays locally scrollable. Focus-trap code is present; a complete screen-reader and keyboard traversal audit was not performed.
- Browser console checked after interactions: no captured warning or error.

## Validation and remaining limits

- Passed: typecheck, 5 fixture/aggregation tests, production prototype build, git whitespace check, strict scaffold doctor after accepting intentional document changes.
- Build emits a JavaScript chunk-size warning (~610kB uncompressed). Prototype fonts also include more subsets than needed. Production code splitting and font budgeting remain necessary; this is not the browser collector's payload.
- Not run: production API/DB, authentication, privacy ingestion, cohort matching, load tests, migrations, deployment, full accessibility audit. Those implementations do not exist in this slice. No lint script is configured.
- API/DB contracts and root runner remain unchanged; the prototype has its own package manifest. Gitignore continues to exclude dependencies, build output and temporary captures.

## Follow-up polish

- P3: exact logo silhouette, icon stroke and reference's subtle background shading could be refined in a later visual pass.
- P3: table position differs slightly because the real UI adds accessible chart data and a sample-state footer absent from the generated mock.

## Implementation checklist

- [x] Source and rendered implementation compared together.
- [x] Actionable layout, tooltip overflow and data-consistency findings fixed.
- [x] Projects, periods, search, sorting, settings and sample states exercised.
- [x] Responsive widths and browser console checked.
- [x] Evidence and production limitations recorded.

## API Connection Mode Additions (2026-10-08)

- `src/api/*` (client, validate, dates, coverage, and pagination) and `src/LiveDashboard.tsx` handle
  real API queries while preserving the visual reference and existing layout. The
  `Sample`/`API connection` toggle in the header switches between them.
- Requests allow only the same origin (rejecting userinfo, queries, and fragments) and use
  `credentials: omit`, `cache: no-store`, and `referrerPolicy: no-referrer`. Default fetch is called
  through the globalThis context.
- Tokens live only in tab memory and private client fields, and server error text is not reflected
  (fixed guidance plus requestId). `Disconnect` clears the token and aborts in-flight requests that
  are reading headers or bodies.
- Contract types, minimal runtime validation, and cross-checks of meta, event, and workflow IDs
  reject responses from another project, version, or period. Missing values are not filled with 0.
- Local validation passed: typecheck, 19/19 sample-model and API-client tests, the production build,
  and 4/4 Sites packaging tests. A JavaScript bundle-size warning remains at approximately 653 kB
  before compression.
- At `http://127.0.0.1:5187/`, the administrator query API from local Miniflare D1 (5188) was
  proxied to verify 3 collections, 1 start, 1 success, a 100% completion rate, daily event
  aggregates and property buckets, and goal and read-only settings. Evidence:
  `.tmp/admin-api-d1-local-20261008.jpg`.
- Invalid and empty schema versions, a 404 for a nonexistent version, a 401 without a token, and
  reset and reconnection after disconnecting were verified. No real authentication provider or
  signature verification was connected; only the verifier port was mocked. The 403 and 503 cases
  were verified only in client and administrator tests.

## OIDC Sign-In Connection Additions (2026-10-08)

- API mode now connects a lazily loaded administrator sign-in flow and a collapsed direct-token
  input. Without configuration, the sign-in button is disabled and guidance is shown. Progress is
  shown with status and failures with alert.
- On the React StrictMode screen in local Vite 5180, verified behavior included no configuration,
  expanding the direct connection, rejection of another-origin endpoint, and returning to the
  sample and re-entering. `/auth/callback?error=access_denied` clears the query immediately, shows
  the API-mode configuration error, and ends the waiting state. No console errors were captured.
- Evidence of the normal sign-in screen is `.tmp/admin-oidc-login-20261008.png` in the repository
  root. No real provider configuration exists, and browser authentication success, provider
  redirect, and refresh were not verified. Isolated client tests use keys generated during the run
  to verify ID signing and PKCE, state, nonce, and refresh.
- Type checking, 31/31 tests, the production build, and 4/4 Sites packaging tests passed. The login
  chunk is 30.65 kB with gzip 10.85 kB, and the main chunk is 657.25 kB with gzip 191.91 kB. The
  existing main-bundle size warning and font optimization work remain. No new full accessibility
  audit or production-provider smoke test was run.
