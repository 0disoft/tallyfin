# Frontend UI Checklist

- Status: Draft

## Failure Modes

Route drift, unclear state ownership, component boundary leakage, accessibility regressions, missing loading/empty/error/disabled states, form bugs, and missing tests.

## Checklist

- `docs/frontend/FRONTEND_DESIGN.md` names the changed route, page model, and component boundary.
- Server State, URL State, Form State, Local UI State, and allowed Global Client State are separated.
- Loading, empty, error, and disabled states are visible for each async interaction.
- Keyboard navigation, focus movement, labels, landmarks, and screen-reader announcements are covered.
- Form validation identifies client-only checks and backend contract checks.
- Frontend tests or smoke checks cover the main route and at least one failure state.

## Validation

- Required validation names: lint, typecheck, test, smoke, check
- Skipped validation must include a reason and remaining risk.
