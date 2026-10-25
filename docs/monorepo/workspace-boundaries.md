# Workspace Boundaries

Status: The packages below are implemented locally. The initial Better Auth/Collector/administrator installation and the 0disoft.github.io page-view pilot were deployed and verified on 2026-10-25; broader workflow integration and remote recovery remain follow-ups. See [validation evidence](../../VALIDATION.md).

## Created packages
- packages/core — Per-project event and property definitions, validation, normalization, hashing, and goal and aggregation rules (no private ZDP or Cloudflare dependency). Local implementation and verification are complete.
- packages/storage-d1 — D1 analytics storage adapter (atomic commits, CAS guards, quotas, and expired-data cleanup). Local implementation and verification are complete.
- apps/collector — Native Cloudflare Worker fetch ingestion boundary (no framework). Minimal browser collection is implemented and verified locally.
- apps/admin — Private `@tallyfin/admin` workspace and React/Vite administrator app. The existing administrator source was moved and connected to root run and verification commands. Follows [ADR 0007](../adr/0007-admin-application.md).
- apps/auth — Private `@tallyfin/auth` workspace; optional Better Auth/OAuth provider Worker and a separate authentication D1. Follows [ADR 0009](../adr/0009-self-hosted-better-auth.md). It does not enter Collector or SDK bundles.
- packages/browser — Browser SDK (no external runtime dependencies and no server core or D1 runtime). Local implementation and verification are complete.
- packages/server — Server publishing SDK (awaited `send` plus caller-owned lifecycle and credential callback, no external runtime dependencies, and no browser, core, or storage runtime). Local implementation and verification are complete, and local Node, Worker, and D1 integration has been verified.
- packages/auth-oidc — OIDC JWT verification adapter for servers (`jose ^6`, no Cloudflare or D1 dependency). The collector connects it explicitly, and it is not included in core or the SDKs.
- examples/sembom — Sembom integration example (registered schema projection and host adapter example). Local implementation and verification are complete, and it has not been installed or activated in the actual Sembom repository.

## Import boundaries
- Core and the SDKs do not depend on private ZDP packages or Cloudflare.
- The browser SDK bundle does not include server runtimes (`packages/core`, `packages/storage-d1`, `apps/collector`, or `node_modules`), and the size check verifies this boundary.
- The server SDK has no runtime dependencies and does not bundle code from `packages/core`, `packages/storage-d1`, or `apps/collector`. The caller owns delivery timing, retry storage, and the credential callback.
- D1 storage is isolated in an adapter.
- Service-specific event integration code is managed in the corresponding service repository. Do not put Sembom's calculation engine or field names into the shared core or SDKs. Sembom's registration example is in the [integration document](../integrations/sembom.md).
- zdp-data-platform owns internal analytics integration contracts, and zdp-platform-observability owns infrastructure observability. Do not add private dependencies from those repositories to Tallyfin core or the SDKs.

## Out of scope
Tallyfin's own payments, consumer service account management, replay, AI, and advertising analytics are excluded. Service actions such as sign-up and purchase completion can be aggregated as registered events, but personal data, amounts, and raw order text are not collected. The server publishing SDK has completed local implementation and verification, and local Node, Worker, and D1 integration for the server SDK has also been verified. Connecting a real provider, deploying a remote database, and adding additional storage adapters are follow-up implementation work.
