# ADR 0003: Minimal, Privacy-First Events

Status: Draft (plan). Not implemented or verified. Undecided items must be settled before activation.

## Decision
Collect only bounded minimal metadata and counters. Do not collect raw input, results, or content.

## Allowlist
- Project ID (routing metadata, not a secret or authentication credential)
- Event names and schema versions registered for the project
- Per-project properties that have been reviewed and registered: bounded enums, booleans, and counters. Additional numeric metrics are reviewed first for scope, aggregation method, and privacy risk.

Unknown events, properties, and versions, as well as invalid data types and ranges, are rejected. Limits apply to value types, property count, length, and the number of aggregation combinations. Fields such as `tool` and `mode` are optional Sembom properties, not common required fields. Product scope was expanded in [ADR 0004](./0004-general-product-analytics.md), and the privacy restrictions in this document remain.

## Prohibited list
Raw input, results, text, health or financial information, email addresses, account, order, and file identifiers, full URL queries, hashes, and referrer paths, the DOM, session replay, fingerprinting, persistent identifiers, analytics cookies, and localStorage or sessionStorage. Do not log request bodies. Event registration cannot bypass this prohibited list.

## Temporary protection
A temporary request IP for protection is not analytics storage, and a policy must be settled before activation.

## Aggregation limits
Bots, spam, blocking, and missing delivery can distort aggregates. Initial goals and completion rates are calculated from the in-memory state of registered workflows. Cross-refresh, cross-device, and browser-to-server linking, arbitrary multi-step funnels, exact unique and returning user counts, and attribution are outside the initial scope.

## Retention
[ADR 0005](./0005-event-and-aggregation-contract.md) settled 90-day daily aggregates, 48-hour receipts, and 72-hour minimal attempt state. Raw events and visitor information are not stored. Actual cleanup work was not yet implemented.

## Administrator access
Administrator authentication and per-project permissions are required, and the mechanism is undecided. Do not borrow a consumer service's user tokens for analytics.
