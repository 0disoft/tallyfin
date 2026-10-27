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
