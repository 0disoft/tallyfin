# Admin Application Instructions

Account password changes must be directly reachable from the signed-in administrator UI through a separate account screen; keep the change form out of the login screen. The password minimum is 12 characters, with the same rule enforced server-side.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build:sites` and `npm run test:sites`; the Sites build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`. Use `npm run build` for the portable app build without Sites metadata.

The selected event-analysis direction is an event explorer with a selected-event detail panel. Enabling previous-period comparison uses a broad event comparison table. Preserve event labels beside their keys, separate browser/server sources, and keep advanced connection settings available without dominating the analysis view.

The selected Goals direction is a goal explorer beside one inspector. Default to the workflow overview with completion rate, outcome counts and daily trend; use separate failure-reason, duration and property-analysis views. Selecting a funnel shows its ordered stage journey, and period comparison uses a current/previous/difference table. Preserve labels alongside registered keys, distinguish pending attempts from confirmed failures, and never describe funnel non-reach as confirmed failure. Keep project/schema/range changes and exports isolated, including when a selected property view unmounts.

The selected Settings direction is option 1: horizontal project/collection diagnostics/schema/SDK/access tabs, with option 4's schema editor beside publication checks. Keep project fields in flat labeled sections and save actions visible. Tab switches must retain drafts, unresolved writes, permission locks and cross-section coordination. Keep JSON and structured forms available; privacy review remains a manual prerequisite after definition validation. Preserve the real numeric limits and paused-project behavior rather than copying illustrative values from generated mocks. Settings has no report date filter; advanced connection/account controls remain reachable without obscuring its tabs.
