# ADR 0001 — Initial Architecture Boundaries

Status: Proposed / record of the initial plan. This is not an implementation or verification status.

## Context

Tallyfin aims to provide minimal, fast, privacy-first product event analytics used by multiple services. The Sembom calculator portal is the first application. General product scope follows [ADR 0004](./0004-general-product-analytics.md). At this point the repository contained only documentation; there was no application, runtime, or deployment.

## Initial implementation direction

- The language is TypeScript.
- The browser SDK has no external dependencies.
- The Worker uses Cloudflare's native fetch with no framework.
- D1 analytics storage is isolated in a separate adapter.
- Core and SDK code have a portable structure without private ZDP or Cloudflare dependencies.

## Consequences

- Portability: core and SDK code can move to another product or host.
- Isolation: collection failures do not affect the connected service's UI or business processing.
- Constraint: D1 write throughput may limit scale, so it must be measured before scaling.

## No framework

The plan is to keep the collection Worker framework-free. The administrator dashboard framework is undecided.

On 2026-10-11, the administrator decision was superseded by the React/Vite adoption in [ADR 0007](./0007-admin-application.md). The text above is a record of the initial plan, and no framework is added to the collector.

## Remaining decisions

Package scope, build scripts, domain, resources, secrets, authentication, retention, license, delivery interval, batch size, retries, dedupe TTL, request size limits, and raw retention period.

Related: [architecture](../../ARCHITECTURE.md), [specification](../product/02-spec.md).
