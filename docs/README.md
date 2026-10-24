# Documentation Index

This index distinguishes completed design documents from unfilled templates.

## Completed planning documents
- [Product brief](./product/00-product-brief.md)
- [Product specification](./product/02-spec.md)
- [Roadmap](./product/01-roadmap.md)
- [Architecture](../ARCHITECTURE.md)
- [Initial architecture direction](./adr/0001-initial-architecture-boundaries.md)
- [Performance budget](./engineering/03-performance-budget.md)
- [ADR 0002: Contract source of truth](./adr/0002-contract-source-of-truth.md)
- [ADR 0003: Minimal, privacy-first events](./adr/0003-minimal-privacy-preserving-events.md)
- [ADR 0004: General product analytics](./adr/0004-general-product-analytics.md)
- [ADR 0005: Event and aggregation contract](./adr/0005-event-and-aggregation-contract.md)
- [Delivery and aggregation contract](./backend/event-contract.md)
- [Collector implementation](./backend/collector.md)
- [Browser SDK](./backend/browser-sdk.md)
- [Administrator query boundary](./backend/administrator.md)
- [Local operations log report screen](./ops/local-report-viewer.md)
- [OpenAPI](../api/openapi.yaml), [DBML](../db/schema.dbml)
- [Sembom integration example](./integrations/sembom.md)
- [Workspace boundaries](./monorepo/workspace-boundaries.md)
- [Package ownership](./monorepo/package-ownership.md)
- [Risk register](./product/03-risk-register.md)
- [Frontend design](./frontend/FRONTEND_DESIGN.md)
- [Selected visual design](./frontend/SELECTED_VISUAL.md)
- [Development guide](../DEVELOPMENT.md)
- [Contributing guide](../CONTRIBUTING.md)
- [Validation](../VALIDATION.md)

## Unfilled templates
Operations and authentication documents under ops/auth that have not been filled in are templates. OpenAPI and DBML have been replaced with the v0.1 Tallyfin contracts, and the core, storage, collector, browser SDK, and administrator query API runtime have been implemented and verified locally. That does not mean production deployment or real identity-provider configuration exists.
