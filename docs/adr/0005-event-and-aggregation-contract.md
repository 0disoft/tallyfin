# ADR 0005: Event Delivery and Aggregation Contract v0.1

- Status: Contract settled. Core validation, the D1 storage adapter, and the minimal browser collector were implemented and verified locally and are pre-deployment.
- Date: 2026-10-08

## Decision

Separate public browser collection from authenticated administrator queries. Each event has a random eventId, and duplicate receipts and payload hashes are retained for 48 hours instead of raw content. Work completion rates use a separate random attemptId to link a start and finish held in the same browser memory. No visitor identifier is kept.

General events are counted by occurrence date, and goals are counted by start date. The timezone is fixed when a project is created, and schema changes are published as new versions. An end that arrives out of order is excluded from the goal until its start is actually received. Receipts, attempts, quotas, and aggregates are applied in one transaction.

Batches contain at most 20 events and 16KiB, attempt lifetime is 24 hours, minimum connection state is 72 hours, and daily aggregates are retained for 90 days. Free text, raw content, and visitor IDs are not stored. Administrator queries require the issuer and subject from a trusted verifier plus a project grant, and an unconfigured deployment stays closed.

## Consequences

Server collection, cross-refresh and cross-device linking, the settings-write API, and selection of a production identity provider are follow-ups. A validation_error does not automatically become a terminal failure. A goal with no failure events shows a null failure count. Origin checks do not prove event authenticity or complete delivery.

Detailed rules are in the [delivery and aggregation contract](../backend/event-contract.md), requests and responses are in [OpenAPI](../../api/openapi.yaml), and the storage structure is in [DBML](../../db/schema.dbml).
