# ADR 0006: Ordered Task Funnels and Cross-Source Linking

- Status: The contract, core logic, per-version registration, validation, publishing, definition lookup, connection-state and step-aggregate storage, connection-event ingestion on collection paths, server SDK link delivery, browser SDK funnel delivery, administrator SDK code generation, the reader/owner funnel daily query API, and the administrator funnel analysis screen, CSV, and step edit form were connected locally.
- Date: 2026-10-11

## Decision

A multi-step funnel counts the milestones of one task, not visitors or sessions. Select 2 to 10 events in order from a project's registered events for a schema version, and fix the browser or server source for each step. The first version uses a different event for each step, and a repeated task starts with a new runId. A schema can hold at most 10 funnels, and all definitions share the existing 32KiB budget.

A link is `funnel = {funnelId, runId, startedAt}`. A new UUIDv4 is created for runId for each task. The project, schema version, funnel, start time, and classification values do not change while the link is alive. Do not use an actual service's order number, file name, or account ID, and do not reuse a visitor ID. An event is explicitly linked to one funnel task, and the same event definition can be selected in a different funnel. There is no feature that links one event to both a workflow and a funnel.

The first logical occurrence time is preserved for each step. A retransmission keeps its original eventId and occurrence time, and even when a new eventId is used for the same task step, the same occurrence time makes it a duplicate step. Resending an already-seen step at a different time or sending a time that reverses the step order produces attempt_conflict (409). Millisecond times can coincide, so different steps with the same time are ordered by their definition order. Work that should be evaluated as a new attempt, such as a retry after failure, uses a new runId.

Every step must occur within 24 hours after the start, and the first step's occurrence time must equal startedAt. Link state is retained only until startedAt + 72 hours. Receipts keep the existing 48-hour per-source deduplication rule, and step aggregates are retained for 90 days based on the start date. Aggregates remain provisional through the project-local date end + 48 hours. This contract is applied by the storage and query implementation.

## Aggregation and delivery order

Even when arrival order is reversed, step times are kept in minimal link state. reachedCount increases only from the actual first step through the contiguous observed steps. If 1, 3, and 4 arrived, only 1 is counted; when 2 arrives later, 2, 3, and 4 are reflected together in the aggregate for the same start date. If the first step never arrives, the task is excluded from both the funnel denominator and numerator. This is separate from general event counts.

The step reached count always satisfies `first step >= second step >= … >= last step`. The system calculates conversion against the immediately preceding step and reach rate against the first step; the result is null when the denominator is 0. The difference between adjacent steps is labeled "did not reach the next step." Because in-progress and missing-delivery tasks are included, do not treat that as failure or confirmed abandonment. Failure causes are analyzed through separately registered events.

## Authentication boundary

The browser path uses the existing public collection Origin and quota checks, and the server path uses the existing publisher verifier and project_publishers permission. The step definition and the ingestion path source must match. Publisher permission is checked immediately before the write, and receipts, links, quotas, and aggregates must be applied atomically. runId is not an authentication method or proof of ownership. Browser steps are public, untrusted observations, and linking a confirmed server completion does not make earlier browser observations authenticated actions.

The host service validates the random link information received with the business request, keeps it in task context, and publishes completion from server code that confirms actual success. Do not pass the request's success flag or an arbitrary event name directly as a server event. Keep the service's internal business ID separate from the analytics ID and do not send the internal business ID to Tallyfin. Keep only reviewed finite classification values. Funnels made entirely on the server follow the same contract.

## Browser funnel profile

Browser link delivery is handled by the optional profile `@tallyfin/browser/funnels` and its `createTallyfinFunnels(options, host?)`, separate from the default SDK entry. Its buffer, retry, and batch delivery share the same in-memory transport as the default client and create no separate storage or endpoint. The profile has no workflow entry point, so work started as a workflow is not continued in the funnel profile, and the reverse also does not happen.

`createFunnelRun(id)` creates a frozen `{funnelId, runId, startedAt}` value, adds no events, and uses no network, storage, or visitor identifier. runId is a new UUIDv4 every time. A funnel whose first step is not browser cannot be created in the browser, and a link started on the server and handed to the browser accepts only browser steps through `trackFunnel`. `track` accepts general events only and rejects registered funnel step names.

`trackFunnel(name, properties, link, occurredAt?)` copies the link, validates `funnelId`, the UUIDv4 runId, and a strict UTC startedAt, and does not change them afterward. Manual retries pass the original occurredAt to preserve the first logical occurrence time, and retransmission with the same occurrence time is a duplicate step under the rules above. Classification values must be the same finite value set for every step in a funnel, and the server rejects inconsistency between steps, so the host must not change dimensions or logical occurrence times while the link is alive. Server steps remain only as null placeholders in the build-time projection, preserving the source boundary.

The default entry does not include funnel code. Examples are in `examples/funnels`, and the gzip budgets are 2912 B for the funnel SDK and 3038 B for the funnel plus reference example, both within the existing 3072 B.

## Administrator SDK code generation

The administrator integration guide generates code by publishing source. Browser code chooses the default `standard` profile (the existing `createTallyfin` and workflow) or the optional `funnels` profile (`@tallyfin/browser/funnels`), and server code carries server rules and participating funnels (server steps by name and browser steps as `null` placeholders). The funnel profile schema matches the projection in `tools/browser/schema.mjs`, omits general events, and removes events used only for task workflows. The example attaches to only one selected registered funnel, and it creates `createFunnelRun` only when that funnel's first source matches the code source; otherwise the host uses the validated delivery context. The example inserts no credentials, classification values are registered properties of the step events rather than link information, and each step records its actual occurrence time once. If no registered funnel involves the source, no funnel profile is generated.

## Implementation order and boundaries

1. Implemented the independent FunnelDefinition, FunnelLink, FunnelEvent, and FunnelCounts in OpenAPI as well as core validation, progress planning, and aggregate calculation.
2. Connected funnels to the per-version schema publishing, query, and registration tools. Existing definitions are read unchanged. Administrator JSON editing, validation, publishing, and hash and conflict rechecks preserve optional funnels.
3. Added funnel_runs and funnel_daily_counts to DBML and added migration 0007. Atomic storage, cleanup, and connection-event ingestion on each existing source's collection path were implemented and verified locally.
4. Implemented and verified server SDK link delivery and integration with Node, a native Worker, and an actual local D1. Implemented and verified browser SDK link delivery through the optional funnel profile locally, and administrator SDK code generation with standard and funnel profiles and server settings locally.
5. Implemented and verified the reader/owner funnel daily query API locally, and connected the administrator goal screen's funnel analysis view, per-step reach table, daily breakdown, funnel CSV, and step edit form locally.

Registry and schema publishing accept optional funnels, and the hash of an existing definition that omits them stays the same. BrowserBatch and ServerBatch accept an optional funnel link on each event, and the collection path stores the link only when it matches the registered step definition for that source. An event containing both attempt and funnel is rejected. The payload hash of a linked event uses the funnel-v1 prefix, while the hash of a general event without a funnel or workflow is unchanged. The server SDK and the optional browser SDK funnel profile support link delivery. Administrator SDK code generation with source-specific standard and funnel profiles and server settings was implemented and verified locally. The reader/owner funnel daily query API was implemented and verified locally, and the administrator funnel analysis screen, CSV, and step edit form were connected locally.
The core progress function does not perform authentication or store link state. Completed work and follow-ups are separated in the [roadmap](../product/01-roadmap.md). The source of truth for the HTTP contract is [OpenAPI](../../api/openapi.yaml).
