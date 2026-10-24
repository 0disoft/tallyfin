# ADR 0004: Tallyfin as a General Product Analytics Platform

- Status: Accepted
- Date: 2026-10-08

## Context
The initial specification treated Sembom's 6 events and calculator visits as common product requirements. On 2026-10-08, the owner corrected the direction so that Tallyfin would be a general product analytics tool used by most Rodisoft services. Sembom is the first application.

## Decision
Event sets and allowed properties are registered and reviewed per project. Limits apply to names, data types, allowed values, ranges, counts, lengths, and the number of aggregation combinations, and definitions are versioned. The shared product does not require event names from a particular service. Sembom's 6 events are separated into an [integration example](../integrations/sembom.md).

Each service defines start, success, and failure events and the publishing source. The system calculates the completed proportion among start attempts for the same aggregation target and does not divide simple event counts to create a global completion rate. Browser and server records of the same task are kept distinct from retransmission duplicates.

This decision replaces the initial specification's global calculator events and visit basis and changes the property allowlist in [ADR 0003](./0003-minimal-privacy-preserving-events.md) to per-project registration. The privacy prohibited list and [initial technical direction](./0001-initial-architecture-boundaries.md) remain. The MVP provides event counts, trends, aggregates by allowed property, and completion rates for workflows held in the same browser's memory. Server integration, arbitrary multi-step funnels, and cross-refresh or cross-device linking remain follow-up contracts and implementation work.

## Consequences
Per-project configuration, permission, and aggregate isolation are required. When definitions differ between services, their conversion rates are not compared directly. Exact unique and returning user counts are outside the initial scope. Add a service with different characteristics beyond the first pilot to identify parts tied to a particular product. Approval of this decision is separate from runtime implementation and production activation.
