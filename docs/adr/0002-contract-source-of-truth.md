# ADR 0002: Contract Source of Truth

Status: Contract basis settled (2026-10-08). Implementation and production had not begun.

## Decision
- The specification and privacy definition are the source of truth for product scope (see [ADR 0003](./0003-minimal-privacy-preserving-events.md)).
- The wire format is api/openapi.yaml, and the logical storage structure is db/schema.dbml. Semantics follow [ADR 0005](./0005-event-and-aggregation-contract.md).

## Current state
The generic examples in OpenAPI and DBML were replaced with Tallyfin's public collection, administrator query, project settings, and aggregation contracts. This version does not provide server collection or settings-write APIs.

## What this does not do
Do not mark contract settlement as completed execution implementation or production authentication. SQL migrations, the collector, SDKs, and the query server are follow-up implementation work.
