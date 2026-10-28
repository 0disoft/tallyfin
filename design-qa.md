# Saylo Korean/English pilot - 2026-10-28

## Sources, state and comparison

- Layout source remains the approved Overview composite:
  `C:/Users/cherr/.codex/generated_images/01a15ad4-6aab-7240-8474-7038a2c27c48/exec-7a023c39-d90f-431d-b440-fac5f1aca05d.png`.
  This pass changes language, not the selected screen design.
- Final captures: `.tmp/admin-overview-Ln3ECF/overview-desktop.png`,
  `overview-en-desktop.png`, `overview-en-390.png` and `overview-768.png`.
  Desktop is 1440x1024 CSS pixels at DPR 1; mobile is a 390x1024 viewport with
  full-page capture. The source is 1487x1058 raster pixels, normalized to 1440px
  width when reviewing the overall hierarchy. Both language states use the
  authenticated local fixture, Sembom, browser source, recent seven days.
- Full-view English desktop/mobile captures were opened and reviewed: header
  selector and date controls fit; translated KPI labels wrap without clipping;
  chart/event hierarchy, configured keys and pending/undefined semantics remain.
  The narrow IAB preview was also switched to English and inspected directly.
  No new raster assets, icons, fonts or design tokens were introduced.

## Interaction evidence and findings

- Browser verification proves locale changes keep the same session/project,
  without another aggregate read or authorization. Editing the English catalog
  updates the selected heading while retaining the unsaved project-name draft.
  Restoring the catalog also retains the draft. Selection persists after reload.
- Existing source/comparison/count/chart/error/retry/navigation assertions pass;
  document-wide overflow checks pass at 390/768/1280px, including the English
  390px state. Fixture and mobile screenshots contain synthetic data only.
- `.tmp/admin-overview-Ln3ECF/report.json`: verified, locale/session/project
  retention, live-copy draft retention and reload preference retention all true;
  `pageErrors: []`, `routeError: false`, `apiWrites: 0`.
- Integration issue fixed: long-lived Vite typegen ownership blocked a concurrent
  build. Explicit type generation replaces that watcher; the final build passes.
- Intentional scope: configured project/event/workflow labels retain their
  original language. Event analysis, Goals, detailed Settings, login dialogs,
  advanced service rows and operational messages are not fully translated yet;
  the English footer states this clearly. API codes/CSV contents are unchanged.
- No actionable P0/P1/P2 layout findings remain. Production delivery was not
  verified. Further page translation is a separate increment.

final result: passed

---

# Overview collection and completion - 2026-10-28

## Visual truth and captures

- Approved source: `C:/Users/cherr/.codex/generated_images/01a15ad4-6aab-7240-8474-7038a2c27c48/exec-7a023c39-d90f-431d-b440-fac5f1aca05d.png`
  (option 1 with option 3's service-table direction).
- Implementation: `.tmp/admin-overview-7ajArc/overview-desktop.png`,
  `services-desktop.png`, `services-detail.png`, and `overview-390.png` in the
  same directory. Earlier iteration: `.tmp/admin-overview-q1h7cs/`.
- Desktop viewport: 1440x1024 CSS pixels, DPR 1; source: 1487x1058 raster pixels.
  Full-view comparison normalizes source width to 1440 (height approximately
  1025) without stretching. Mobile evidence: 390x1024 CSS viewport and full-page
  capture; 768px and 1280px evidence is also saved.
- State: authenticated isolated local fixture, Sembom, browser source, recent
  seven days, comparison off; separate expanded service-table state. Captures
  contain synthetic local counts, not production measurements. The final source
  and rendered desktop/mobile captures were opened together for comparison.
  Focused `services-detail.png` verifies both rows and all five columns beyond
  the scrollable main viewport. IAB preview was also inspected directly.

## Findings and comparison history

- Fixed P1: forcing the Recharts wrapper width through overview CSS collapsed
  the chart to zero width. Removed the conflicting override. Final evidence has
  seven visible bars; browser checks require a surface wider than 200px.
- Fixed P1: the inherited event-table first-column width (72%) squeezed service
  counts and completion details. Scoped fixed layout/column widths restore all
  five columns; browser checks require every header cell to exceed 70px.
- Fixed P2: the initial KPI labels mixed workflow and start-event names; both
  attempt metrics now name the representative workflow. Added the explanatory
  subtitle and sized the icon-bearing segmented source selector to match the
  chosen hierarchy. Final desktop/mobile evidence confirms no clipping.
- Full view retains the intended hierarchy: compact header, source controls,
  unboxed metrics, bars beside ranked labeled events, outcome strip, then service
  disclosure. Typography uses existing Inter/Noto Sans KR, slate/white surfaces,
  blue actions, existing raster brand and Phosphor icons. No decorative assets
  were substituted. Mobile uses a two-column KPI grid and stacked content.
- Intentional adaptations: live API controls and CSV stay available, event keys
  and accessible daily-value tables remain, the timezone is read-only, comparison
  requires its real reads, and fixture bars reflect actual seeded counts. The
  undefined failure event shows `미정의` and 680 pending, rather than copying the
  illustrative failure/pending values in the mock. Compact spacing accommodates
  the real controls; service criteria remain inspectable without dominating.
- No actionable P0/P1/P2 findings remain. Production data/authentication and
  deployed asset delivery were not part of this local review.

## Interaction and console evidence

- `verify:admin-overview` passes source switching, lazy service reads, current
  versus previous-zero comparison, workflow 503/retry, no representative workflow,
  event/goal navigation, chart dimensions and responsive overflow checks.
- Final report: `.tmp/admin-overview-7ajArc/report.json`: `verified: true`,
  `overviewReads: 1`, `pageErrors: []`, `routeError: false`, `apiWrites: 0`.
- IAB retained one earlier development hot-reload AbortError during effect
  cleanup; the final fresh isolated browser run has no page errors.
- Typecheck/build, 382 admin unit tests, 2 bundle checks and analysis-access
  verification pass. Existing server state, auth and API/DB contracts are intact.
- Follow-up P3: individual daily bar-value labels could be added for short ranges;
  values are already available through tooltip and the accessible table.

final result: passed

---

# Settings design QA — 2026-10-28

## Target and rendered evidence

- Selected sources: project layout option 1,
  `C:/Users/cherr/.codex/generated_images/01a15ad4-6aab-7240-8474-7038a2c27c48/exec-981df9f6-f860-4d07-b577-9f7fc039135f.png`;
  schema workbench option 4,
  `C:/Users/cherr/.codex/generated_images/01a15ad4-6aab-7240-8474-7038a2c27c48/exec-3c7adb57-2f31-4878-8ed4-36d1d654bf93.png`.
- Sources are 1487 x 1058px, normalized to 1440 x 1024px. Browser evidence is
  1440 x 1024 CSS/image pixels at deviceScaleFactor 1, light theme, signed-in
  local fixture owner. Content is the actual Sembom fixture, not production data.
- Final captures: `.tmp/admin-settings-workspace-l0mifi/project-desktop.png`,
  `schema-desktop.png` and `project-mobile.png` (390 x 1024px).
- Full-view comparisons opened as combined inputs:
  `.tmp/settings-project-comparison.png` and `.tmp/settings-schema-comparison.png`;
  each is 2880 x 1024px with source left and implementation right.
- Live IAB inspection: `http://127.0.0.1:5191/`, isolated local-D1 fixture,
  project and schema panels. Never connected to production. Main interactions
  were also exercised through the repository's signed-OIDC browser fixture.

## Findings and iteration history

- Initial [P2]: duplicate project heading and roomy fields pushed collection
  limits below the first desktop viewport. Hid the redundant visual heading,
  shortened the origin textarea and tightened row spacing. Final project capture
  shows the labeled rows and persistent actions; the mobile form stacks normally.
- Initial [P2]: expanded connection controls covered schema tabs. Kept the open
  disclosure in header flow. Existing navigation and server-draft refresh checks
  pass with this disclosure open, including cross-section recovery.
- Initial [P2]: schema utilities and version input pushed publication actions
  below the desktop viewport. Moved collapsed utilities beside the heading and
  the version field beside editor selection, with an accessible hint/title.
  Bounded the resizable JSON editor. Final same-state comparison shows both
  editor and publication action row in the desktop viewport.
- No actionable P0/P1/P2 findings remain. Intentional adaptations: actual
  validation ranges/status semantics, multiline origin editing, real schema JSON,
  manual privacy checkbox, existing account navigation in connection controls,
  and collapsed file/server-draft utilities instead of fabricated one-click saves.

## Required fidelity surfaces

- Typography: existing self-hosted Inter/Noto Sans KR, clear title/section/field
  hierarchy and readable 13–14px controls. JSON uses a monospace textarea.
- Spacing/layout: compact 220px shell, flat two-column project rows, horizontal
  tabs, editor/inspector split and explicit save/publish actions. At 390/768px
  panels stack; the tab strip scrolls without document-wide horizontal overflow.
- Colors/tokens: white/slate surfaces, #155eef actions/selection, subdued borders,
  green only for a current successful definition validation.
- Assets: existing Tallyfin raster brand and Phosphor icons; no new decorative
  images or replacement logos. Fields remain editable native controls.
- Copy/content: uses the actual fixture's values, true owner/reader capabilities,
  and real request/UTC-day limits. No mock credentials or fabricated health states.
- Focused review: mobile project capture and direct IAB AX/visual review of
  labels, segmented status, version input, privacy checkbox and action buttons.
  Full combined captures were inspected with the 1440px implementation captures
  opened separately to read fine text that the combined display downscales.

## Interaction and verification

- Five tabs, roving focus and arrow/Home/End selection; one visible panel.
- Settings/schema drafts retained across tab/view changes; unresolved writes,
  revoked access, project switches, disconnect and explicit recovery preserved.
- Definition validation and manual privacy gate, malformed-JSON focus, JSON/form
  switching, actual local-D1 PATCH and 390/768/1280px overflow checks passed.
- Version comparison, server draft conflict/lost-response handling and settings
  write recovery passed. No page errors or fixture route errors were reported.
- Existing admin unit tests: 382 passed with test-concurrency 2. The first fully
  parallel run hit one unrelated 10ms read-scheduler timing assertion under load;
  it passed in the bounded-concurrency run without code/test changes.
- Typecheck, portable Vite build and emitted lazy-bundle checks passed. Sites
  packaging and production deployment are outside this local implementation.
- Follow-up P3: a syntax-highlighted editor could be evaluated separately; the
  current native textarea preserves existing editing/validation behavior.

final result: passed

---

# Previous Goals design QA — 2026-10-28

## Target and evidence

- Approved combination: goal explorer/inspector (option 3), default overview
  (option 1), funnel journey (option 2), and current/prior comparison (option 4).
- Primary source: `C:/Users/cherr/.codex/generated_images/01a15ad4-6aab-7240-8474-7038a2c27c48/exec-2c280bfc-ba42-44f9-a61c-e539c0ae677c.png`
  (1487 x 1058 pixels, workflow failure tab).
- Final production-build IAB preview: `http://127.0.0.1:5190/`, isolated GET-only
  example API. The project is labeled example data; no production writes,
  credentials or traffic measurements are involved.
- Same-state capture: `.tmp/goals-failure-desktop-final.png`, 1652 x 1176 pixels
  including IAB capture padding. Measured DOM viewport: 1487 x 1058 CSS pixels,
  browser zoom/pixel ratio 90%/0.9. `.tmp/goals-failure-desktop-cropped.png`
  removes right/bottom capture padding without resampling app content.
- Same-input comparison: `.tmp/goals-qa-comparison.png`, source left and current
  failure view right. Both show the conversion workflow, 86.0% rate, 4800 starts,
  4128 successes, 96 confirmed failures and 576 pending attempts. Failure splits
  and taxonomy follow the validated example API rather than invented labels.
- Other reviewed states: `.tmp/goals-overview-desktop-cropped.png`,
  `.tmp/goals-comparison-desktop-cropped.png`,
  `.tmp/goals-funnel-desktop-cropped.png`, `.tmp/goals-overview-mobile-final.png`.
- Responsive/access evidence: `.tmp/admin-goal-access-zVAAMY/report.json`,
  17 scenario groups and captures at 390/768/1280px. IAB mobile DOM/document
  widths both measured 390px. Final production-build console: no errors/warnings.

## Findings and fixes

- P2, chart resize: the previous desktop SVG width briefly escaped on rotation.
  Clip only the chart viewport; immediate resize assertions now pass and wide
  numeric tables retain local keyboard-accessible scrolling.
- P2, tabs: an underline extending outside its scroll box created a vertical
  scrollbar. Moved it inside and suppressed vertical tab overflow. Rechecked.
- P2, failure/funnel hierarchy: added failure-share bars and explicit blue native
  progress styling, preserving numeric text, accessible values and denominators.
- No remaining P0/P1/P2 findings. Source and implementation were opened together
  and inspected at full size, including explorer labels/keys, selection styling,
  outcome counts/strip, failure bars, tabs and comparison cells.

## Required fidelity surfaces and accepted adaptations

- Fonts/type: retained self-hosted Inter/Noto Sans KR; titles, completion rate
  and outcome counts establish the hierarchy. Labels and registered keys remain
  distinct. Compact sizing intentionally follows the approved event workspace.
- Spacing/layout: existing 220px navigation, 280px explorer, flexible inspector;
  mobile stacks explorer above detail. Operational comparison/CSV controls remain
  in a compact action strip; connection/schema settings expand in the header.
- Colors/tokens: existing blue/white/slate palette; blue completion/success,
  red confirmed failure, muted pending, plus explicit text for each status.
- Images/icons: retained Tallyfin raster branding and Phosphor icons; no new
  decorative imagery or handmade icons. Bar/chart data remains programmatic.
- Copy/content: validated cohort counts/rates, unknown no-start/historical
  values, %p rate changes. Pending is not failure; funnel non-reach is not a
  confirmed failure. Registered enum keys and measurement diagnostics replace
  the mock's illustrative reason labels; missing values never become fake zeros.
- The default inspector is overview as approved. Funnel list rows show stage
  count instead of an unread completion rate; only a selected funnel is fetched.
  Existing detailed tables, daily drilldown, property reads and CSV remain.

## Checklist

- [x] Desktop source/current comparison and detailed hierarchy review.
- [x] Overview, failure bars, funnel stages and period comparison.
- [x] Search empty state retains detail; native keyboard goal selection.
- [x] Loading/error/recovery, denied access, disabled CSV and stale responses.
- [x] Mobile/tablet/desktop overflow assertions and local table scrolling.
- [x] Typecheck, 382 admin tests, build, 2 bundle tests, both access browser checks.

final result: passed

---

# Event analytics design QA — 2026-10-28

## Comparison target and evidence

- Source visual truth: `C:/Users/cherr/.codex/generated_images/01a15ad4-6aab-7240-8474-7038a2c27c48/exec-822dd9f6-ce8d-4533-bbb9-c94dbedacac8.png`
  (selected event-explorer mock, 1586 × 992 pixels).
- Implementation: `http://127.0.0.1:5188/`, isolated GET-only example API.
  No production data, credentials or service calls are involved.
- Desktop screenshot: `.tmp/events-desktop-final.png`, 1762 × 1103 pixels.
  Measured DOM viewport: 1586 × 993 CSS pixels. The in-app screenshot includes
  right/bottom padding; comparison clips that padding at 1586 × 992 without
  resampling app content. Device scale factor is 1; browser zoom is 90%.
- Full-view comparison: `.tmp/events-qa-comparison.png`, 3172 × 992 pixels,
  source left and implementation right. Both show browser-source `page_view`,
  seven events, the same daily series, and a locale breakdown.
- Focused review: the source and implementation full-size captures were opened
  separately to read event labels/keys, zero counts, selected-row styling,
  totals, tabs, property selector, and percentage bars. The combined capture
  establishes their position in the full composition.
- Comparison state: `.tmp/events-comparison.png`; current/previous totals,
  absolute/percentage change, shared-scale bars, and selected-event detail.
- Mobile post-fix: `.tmp/events-mobile-final.png`; measured viewport 351 × 760
  CSS pixels, document width 334 pixels excluding the scrollbar, and a bounded
  168-pixel event list. The surrounding screenshot canvas has extra padding.

## Findings and comparison history

1. [P2, fixed] At 351 pixels, inherited column layout treated the title's flex
   basis as vertical space, pushing the period control far below the title.
   Evidence: `.tmp/events-mobile-before-header.png`. The mobile header now uses
   a wrapping row, with period/timezone controls in a compact column and project
   controls on their own row. Post-fix evidence: `.tmp/events-mobile-final.png`.
   Header height is 132 pixels; the selected-event heading and total are visible
   at the bottom of the first viewport. No document-level horizontal overflow.
2. The desktop comparison retains the selected mock's navigation / explorer /
   inspector hierarchy, clear selected event, large total, trend, and detail tabs.
   Remaining differences below are intentional product adaptations, not hidden
   functionality or unresolved visual defects.

## Required fidelity surfaces

- Fonts/typography: existing self-hosted Inter/Noto Sans KR retained. Bold titles,
  blue total, muted event keys and tab emphasis reproduce the visual hierarchy;
  real fonts replace the generated mock's approximate lettering.
- Spacing/layout: 220-pixel navigation and 280-pixel explorer leave more chart
  width than the mock. Seven event rows remain visible on desktop. Production
  comparison/CSV controls occupy a separate compact toolbar. Mobile stacks the
  explorer and inspector and limits the event-list height.
- Colors/tokens: white and pale neutral surfaces, muted blue-gray metadata,
  blue selection/positive change, and orange negative change. Changes also have
  explicit numeric signs so color is not the sole distinction.
- Images/assets: existing Tallyfin logo and Phosphor icons retained; no invented
  raster illustration is required. The existing real data chart is preserved,
  including accessible numeric-table disclosure, instead of drawing a mock chart.
- Copy/content: Korean labels remain beside event keys. Example-project naming
  identifies the preview as synthetic. Property values come from registered
  schema/API data; no language-label translations are invented. Breakdown totals
  differ slightly from the generated mock because the fixture computes integer
  daily buckets. The operational schema/version metadata stays available.

## Interaction and error checks

- Event switching, property and daily tabs, locale selection, empty search,
  source with no registered events, comparison on/off, and mobile menu inspected.
- Unit suite: 380 passed, including zero/null counts and zero/null comparison
  baselines. Browser access suite passed timezone and oversized-response recovery,
  permission revocation, export isolation, late-response isolation and disconnect.
- Automated browser suite reported zero page errors and zero administrator API
  writes. Preview logs contained two earlier development hot-reload errors; no
  additional errors appeared during the post-reload comparison/mobile checks.
- API, DB, authentication contracts and production deployment are unchanged.

## Implementation checklist

- [x] Selected reference opened and compared with browser-rendered implementation.
- [x] Explorer, detail tabs, property bars and comparison table work with API state.
- [x] Mobile header gap fixed and recaptured; event list bounded without page overflow.
- [x] Permissions, cancellation, unknown counts and CSV safeguards remain covered.
- [x] Shell and analysis styles split while preserving their cascade order.

## Follow-up polish

- [P3] Richer translated property-value display names can follow schema support.
- Production data/login and production asset delivery were not verified locally.

final result: passed
