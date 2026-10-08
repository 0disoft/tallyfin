# Frontend Design

- Status: Draft

## 0. Decision Summary

Record accepted decisions, rejected options, owners, and remaining UNDECIDED items.

## 1. Product Surface and Scope

Name the product surface, primary users, entry points, non-goals, and ownership boundary.

## 2. User Flow Map

Map happy paths, failure paths, permission paths, and recovery paths.

## 3. Routing Contract

List routes, URL parameters, query parameters, redirects, and not-found behavior.

## 4. Page and Layout Model

Define page shells, persistent regions, scroll behavior, responsive breakpoints, and empty layouts.

## 5. State Ownership Model

Assign Server State, URL State, Form State, Local UI State, and allowed Global Client State.

## 6. Data Fetching and Cache Policy

Define fetch timing, cache keys, invalidation, retry, optimistic updates, and stale data behavior.

## 7. Component Boundary Model

Describe app/pages/features/entities/shared layers, import direction, and reusable component limits.

## 8. Design Token Contract

Name semantic token roles for color, spacing, typography, surfaces, status, and interaction states.

## 9. Interaction and Accessibility Contract

Define keyboard paths, focus order, labels, landmarks, announcements, and reduced-motion expectations.

## 10. Loading, Empty, Error, and Disabled States

List loading, empty, error, and disabled states for each route and async action.

## 11. Form and Validation Model

Separate client validation, backend validation, error display, dirty state, submit, reset, and recovery.

## 12. Responsive and Layout Rules

Define width ranges, wrapping rules, long-content behavior, viewport constraints, and safe-area handling.

## 13. Observability and Analytics

Name events, analytics, logs, client errors, performance marks, and privacy limits.

## 14. Test Strategy

Map unit, component, route, accessibility, contract, and smoke coverage to user-visible risks.

## 15. Implementation Sequence

Break work into safe slices with validation after each slice.

## 16. Open Questions and Decisions Log

Track open questions, decision owners, due dates, and decision-reversing evidence.

## State Definitions

- Server State: remote data owned by backend contracts.
- URL State: route, query, and hash data that must survive reload and share links.
- Form State: draft user input owned by a form boundary.
- Local UI State: temporary visual or interaction state owned by one component area.
- Global Client State: client-owned state allowed only by explicit allowlist.

## Global State Allowlist

- Auth session summary when required.
- Current tenant or organization selection when required.
- Feature flags when required.

## Global State Denylist

- Server response copies.
- Form drafts.
- One-off modal state.
- Derived values that can be computed locally.

## Component Layers

app -> pages -> features -> entities -> shared.

Imports may point downward only. Shared must not import entities, features, pages, or app.

## State Categories

Loading, empty, error, and disabled states must be defined per route and per async interaction.

## Accessibility Contract

Keyboard paths, focus movement, visible focus, labels, semantic landmarks, and screen-reader announcements must be explicit before implementation.

## Semantic Token Usage

Use semantic tokens for color, spacing, typography, state, and surface role. Do not hardcode product-specific visual choices here.
