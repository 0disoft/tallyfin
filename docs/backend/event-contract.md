# Event and Aggregation Contract v0.1

The v0.1 design contract was finalized on 2026-10-08. Core validation, the D1 storage adapter, the minimal browser
collector, administrator reads and project settings changes (including the verifier port), and server publishing ingestion have been
implemented and verified locally; production deployment does not exist yet. A real identity provider and production grant assignment are also follow-up work.
No migrations or production data have been applied remotely. Implementation status is documented in
[Collector Implementation](./collector.md) and the [Administrator Read and Settings Boundary](./administrator.md). Shapes follow
[OpenAPI](../../api/openapi.yaml) and [DBML](../../db/schema.dbml), and decisions follow
[ADR 0005](../adr/0005-event-and-aggregation-contract.md).

Regular events are counted on the date each step occurs, while completion rate is calculated from the attempts whose start was actually received and that succeeded.
The two values can therefore differ. An input validation error is a regular event that can be corrected; it is not an automatic terminal failure.
Raw events and persistent visitor identifiers are not stored.

## Registered Definition

A project has an active status, an exact origin list, a fixed IANA time zone, a per-minute request limit, and a new-receipt
limit per UTC receipt date. The defaults are 120 requests per minute and 100,000 new IDs per day.
Origins compare only scheme, host, and port; paths, wildcards, and null are forbidden. Production uses HTTPS; only local development allows HTTP.
Settings registration and changes require owner authorization.
New schema versions can also be published through an owner-only PUT, while project creation uses a separate creator-authorization POST or the CLI. Grant management belongs to the provisioning CLI. Existing project
settings can also be changed through the administrator API ([Administrator Read and Settings Boundary](./administrator.md)).

Events, workflows, and optional funnels in a schema version are immutable; changes are published as a new version. Only active versions
ingest data, and retired versions are read-only. Multiple active versions can support older clients.
Regardless of source, there are 1 to 50 event types and up to 10 workflows; a schema containing only server definitions is also
allowed. A server-only schema has an empty workflows array. The number of allowed browser origins is 0 to 16, and an empty list rejects all browser ingestion.
The list is not used for server authentication.
Server HTTP ingestion (`POST .../server-batches`), publisher authentication, the authorization management CLI,
the server publishing SDK, and source-specific read APIs (`source`) have been implemented and verified locally. The server batch storage adapter validates
the batch in the core and checks project publication authorization separately. Migration 0006 preserves browser receipts and event aggregates, broadens the
source constraint, and adds an empty `project_publishers` table. Publication authorization is checked again in the same
batch immediately before storage. Real provider connections and remote deployment do not exist yet. `definitions_json` is 32 KiB or less.

A property set has at most 4 properties and allows only booleans, fixed enums of 1 to 32 values, or integer ranges of at most 32 values.
An omitted optional value also counts as a value type, and the product of possible combinations is limited to 256 or less for each event or workflow.
Free-form strings, floating-point numbers, nested objects, and arrays are forbidden. Registration records a purpose and
reviews the personal-information prohibition list. Enum registration must not permit account, order, input, or result information.

A workflow's start, success, and optional failure events must be distinct and use the same browser source.
Each event belongs to at most one step of one workflow. Dimensions are properties with the same type and allowed values that are required on every step,
and a value change within an attempt is rejected. A correctable
`validation_error` remains a regular event. Workflows without a failure step are also allowed.

## Transport, Time, and Retry

`POST /v1/projects/{projectId}/batches` accepts `source`, `schemaVersion`, and `events`.
A batch contains at most 20 events and 16 KiB of UTF-8 and is sent as `application/json` or `text/plain; charset=utf-8`.
Both are parsed as JSON and checked against the same schema, and compressed `Content-Encoding` is rejected.
The outer and event objects have closed field sets, and properties are checked again against the registered definition.
The duplicate key for Beacon is inside the event rather than in a header. A successful Beacon return is not proof of storage success.

`eventId` and `attemptId` are lowercase UUIDv4 values generated with a cryptographic random source. If generation fails, do not send;
each is used for one event or one attempt. Do not send raw input, results, file or order IDs, user IDs, URLs, referrers, DOM data,
persistent identifiers, or analytics cookies. Do not use `localStorage` or `sessionStorage` either.

`occurredAt` and `startedAt` use the UTC RFC3339 `Z` form with 0 to 3 fractional-second digits on the real calendar. Internally,
they are normalized to milliseconds. `occurredAt` is allowed only from 24 hours in the past through 5 minutes in the future relative to server receipt.
A start step has `occurredAt = startedAt`; a completion is at or after `startedAt` and within 24 hours. Client
time is not proof that an event is authentic.

The SDK uses a 40-event memory buffer, sends asynchronously every 20 events or every 5 seconds, and attempts to send the remaining batches when the page is hidden.
It retries only network and timeout failures (status 0), 408, 429, and all 5xx errors, at most 2 times and within a total
10 minutes, preserving the original ID, time, and body. It does not retry 401, 403, 409, or 422.
Retry-After ([RFC 9110 `10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)) takes priority for waiting;
integer seconds are used as-is, and a standard IMF-fixdate (for example `Thu, 08 Oct 2026 15:01:15 GMT`) is converted to the remaining time
relative to the browser host's current time. The minimum is 1 second, and a past time is also treated as 1 second.
If the format does not match, use 1-second and 2-second backoff. If the wait would reach 10 minutes from batch start, discard the batch without retransmitting.
Business logic or rendering does not wait for transmission. A full buffer drops new events, and a workflow whose start cannot be buffered does not create a completion.
Buffering an event is not proof of actual delivery.

## Duplicates and Atomicity

The receipt key is project, source, and eventId. The hash is the SHA-256 of the project, version, source, and the complete normalized event.
It sorts keys, distinguishes typed values from omission, normalizes times to millisecond `Z`, and then hashes. The same key and content are
duplicates, while changed content returns 409 and rejects the whole batch. Reusing the same ID in a different version also returns 409.
A repeated ID within one batch returns 422.

After checking every event, receipts, attempts, the UTC receipt-date quota, and event and goal aggregates are applied in one storage
transaction. Either all are applied or all are rolled back. After a lost response, retransmit the original IDs. A concurrent unique conflict
rereads the data to decide whether it is a duplicate or conflict, and does not count it twice. If the whole batch is rejected, no partial
accepted response is produced.

When the same step of a compatible attempt is repeated with a new eventId, an already counted step is a duplicate.
The new receipt is stored and counted toward the UTC daily new-receipt limit. A completely identical retransmitted ID does not increase
new receipts, aggregates, or the daily limit. Per-minute admission limits include duplicates and invalid requests.
Requests rejected by the browser route's rejected origin or optional front limit do not consume database limits. The successful response's `accepted + duplicates` must equal the batch event count.

The storage adapter applies contention exactly once with a CAS guard based on `projects.ingest_revision`.
If provisioning changes the active schema definition or an administrator settings change occurs, the revision increases and the batch is rejected
fail-closed. Details follow [Collector Implementation](./collector.md).

## Goals and Dates

Workflow steps require `attempt = {workflowId, attemptId, startedAt}`, while regular events forbid it.
The attempt key is project, source, and attemptId. After the first receipt, changing the version, workflow, start time, or
dimensions returns 409. Start is accepted once, and only the first committed completion is retained.
A different completion result that arrives later returns 409. A batch is processed in `occurredAt` and `eventId` order.

If the completion arrives first, only a pending linkage state is kept and nothing is added to the goal. The transaction that receives
the actual start adds `started` and the corresponding succeeded or failed count together. A start that never arrives is excluded from
the goal. Regular event counts reflect each received step on its occurrence date, so an unlinked completion can still appear in the event table.

The goal date is the date of `startedAt` in the project time zone. The invariant is `succeeded + failed <= started`,
with `pending = started - succeeded - failed`. If there is no failure step, `failedAttempts` is
null and `pending` is `started - succeeded`. Completion rate is `succeeded / started * 100` for that start cohort, and it is null when
`started=0`. Results are `provisional=true` until 48 hours after the end of the date. They still do not prove delivery completeness
or event authenticity.

For a start at 23:59:50 on October 8 in Seoul and completion at 00:00:10 on October 9, the regular event dates differ, but
the goal's start and completion counts both belong to October 8. Refreshing removes in-memory linkage, and a server completion is not
linked to a browser start. Examples are in [batch](../../api/examples/browser-batch.json) and
[goal response](../../api/examples/workflow-response.json).

## Funnel Linkage Ingestion

Events sent with the same source as a registered funnel's step include a
`funnel = {funnelId, runId, startedAt}` link. They also count toward regular events, while funnel step reach is aggregated separately.
An event with a funnel link does not use `attempt`; including both `attempt` and `funnel` on one event is rejected. An event with a funnel
is not interpreted as a workflow. Each run gets a new UUIDv4 `runId`, which is not a visitor ID, credential, or
proof of ownership.

Steps are identified by event name and registered source. The first step must have `occurredAt = startedAt`, and every
step must occur within 24 hours after `startedAt`. An unregistered step name or source, or a time outside that window,
returns `invalid_event` (422); a mismatch with stored linkage or a different time for an already seen step returns
`attempt_conflict` (409). The same key and content are duplicates, and the 48-hour receipt window applies.
Storage updates the minimal linkage state and adds to the start-date cohort only steps observed consecutively from the actual first step.
If receipt order is reversed and an earlier step arrives later, the consecutive range is included as well. If the first step never arrives, the attempt is not
included in funnel aggregates. Linkage state is retained for `startedAt + 72 hours`, and step aggregates are retained for 90 days from the start date.

## Storage and Retention

There are no raw event or visitor tables. Regular events store only counts by date, project, version, source, event,
and reviewed property combination. Goals store only start, success, and failure counters by start date, project, version, source, workflow, and
dimensions. Funnels store only step reach counts by start-date cohort, project, version, funnel, and dimensions, and
step times in the minimal per-run linkage state. `dimension_key` is sorted typed JSON and distinguishes omission from false, 0, and strings.
One key is 512 bytes or less, and properties are not stored by hash alone.

- Receipts: `receivedAt + 48 hours`.
- Minimal attempt state: `startedAt + 72 hours`. Reads also check expiration when deletion is delayed.
- Funnel linkage state: `startedAt + 72 hours`. Retransmitting a step does not extend it.
- UTC receipt-date quota: 72 hours after the end of that UTC date.
- Aggregates: the project-local current day and the preceding 89 days, 90 dates in total.
- Settings and grants: until explicitly removed. A schema definition is not deleted while its aggregates remain.

Old original events are rejected by the time check, so they are not reaggregated after receipt cleanup.
An attacker using a newly written timestamp in an ID is a limitation of public ingestion. A time-zone change is handled as a new
project. If a count exceeds the safe-integer range, the transaction stops.

## Reads, Authorization, and Operations

After a trusted verifier converts a bearer token to issuer and subject, the administrator checks
`project_grants` on every request. A plain JWT decode or screen project selection is not authorization.
Lists return only accessible projects in ascending ID order, and every cursor is checked.
An identity provider and token issuance are follow-up implementations; the administrator API stays closed without configuration.
Readers and owners can read, while only owners can change project settings or perform provisioning.
A settings change checks the grant again at write time and rejects with `settings_conflict` (409) when `expectedSettingsHash` differs
from the current canonical hash. Ingestion alone is not a conflict.
Administrator reads, settings changes, and grant condition checks have been implemented and verified locally.

Aggregate reads require an exact schemaVersion, a project-local from/to period within the 90-day retention window and at most 31 days,
and `from <= to <= today`. A request aggregates only one source and one version. `summary` and event
daily accept optional `source` (default browser; browser or server), while workflow reads are browser-only. The event table
groups by one event and one optional property, fills empty dates with 0, and returns null completion rate for an empty goal date.
A storage failure or denied authorization is not disguised as 0. Coverage is observed-only, and
`latestReceivedAt=null` means no new receipt has ever been received. An event stored on tomorrow's date because of a 5-minute client
clock error becomes visible when that date enters the query range.

CORS reflects only allowed origins exactly, sets `Vary: Origin`, and uses `credentials=false`.
No public ingestion route elevates authorization with a bearer token. Responses use no-store and issue no analytics cookies.
Request bodies, tokens, IP addresses, Origins, and full URLs are not written to logs or the analytics database.
Diagnostics use only a temporary requestId and fixed error codes. IP handling and retention for abuse prevention and edge
rate-limit implementation are decided before activation. This contract alone does not claim that bot blocking is complete.
