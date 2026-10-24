# Package Ownership

Status: Core, storage-d1, collector, browser, server, and the React/Vite admin app were implemented and verified locally, including the Sembom example. They currently use only the local `@tallyfin` scope; the public npm scope and release process are undecided.

## Responsibilities
- core: Per-project event and property registration definitions, validation, normalization, and goal and aggregation rules. It does not treat a particular service's event names as global requirements. Local implementation and verification are complete.
- browser: Minimal SDK. There is no synchronous collection I/O and no waiting for rendering or calculations. Local implementation and verification are complete.
- server: Server publishing SDK. `send` is an awaited batch delivery, and the caller owns lifecycle, retry storage, and the `getToken` callback. It has no external runtime dependencies and bundles no browser, core, or storage runtime. Local implementation and verification are complete, and local Node, Worker, and D1 integration has been verified.
- storage-d1: D1 aggregate storage adapter. It includes atomic commits, CAS guards, quotas, and expired-data cleanup. Local implementation and verification are complete.
- auth-oidc: JWT signature, claim, and public-key verification adapter for servers. It takes host configuration and does not depend on Cloudflare or D1. It is not included in core or the SDKs.
- collector: Worker ingestion boundary. It validates according to project, schema, and publishing source and aggregates the result. Minimal browser collection is implemented and verified locally.
- admin: Per-project queries, event analytics, goals and workflows, and settings. Project settings and queries pass permission checks.
- Service integrations: Owned by each service repository. Sembom is the first example and does not stand in for integration code in other services.
- examples/sembom: Sembom integration example. Applying it to the actual Sembom repository is separate work.

## Public and private integration
A public project ID is routing metadata and not a secret or authentication credential. Do not add private ZDP or Cloudflare dependencies to core or the SDKs.

## Source of truth
Product scope follows the product specification, API shapes follow OpenAPI, and storage structure follows DBML. The v0.1 contract was settled in [ADR 0005](../adr/0005-event-and-aggregation-contract.md), and core validation, storage, and the collector were implemented and verified locally. tools/contracts checks development-only contracts and is not a runtime dependency of core or the SDKs.

## Version plan
Events include a schema version. Package versions and distribution method are undecided.

The SDK tarball's file list, installation in an external project, types, and ESM entry points are checked locally with the optional `npm run verify:sdk-packages` command. It does not publish packages or change versions; follow the [package verification guide](../../tools/sdk/README.md).
