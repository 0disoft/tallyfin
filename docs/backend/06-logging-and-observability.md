# Collector Log Boundaries

`retention_cleanup` logs record the final execution diagnostics for normal, exceptional, and cancelled runs.
They record only the execution time, scheduling delay, stop reason, work with an unknown result, and progress confirmed through CAS, and exclude raw errors and
project identifiers. A `retention_cleanup_failed` entry with the same `runId` is not a duplicate execution.
Log compatibility and timing limitations follow [Operational Observability](../ops/observability.md#cleanup-execution-latency-and-interruption-reasons).

Status: RequestId and fixed-code logs, per-project rejection diagnostic aggregates, and the completion observation log (`http_request`) have been
implemented and verified locally. Remote log collection, dashboards, alert recipients, and production deployment do not exist yet.
Operational observability settings have not been decided and remain UNDECIDED in [Operational Observability](../ops/observability.md).

Request bodies, tokens, IP addresses, Origins, full URLs, and property values are not stored in logs or the analytics database.
Diagnostics use only a temporary requestId, fixed error codes, and approved operational counters.
Daily product aggregates and infrastructure operational observability are separate. IP handling and retention
policy for abuse prevention are defined before production activation, and IP addresses collected for that purpose are not reused for product analytics.
See the [Event Contract](./event-contract.md).

## Completion Observation Log

`request-observation.ts` writes one line when a response is ready. It has exactly seven fields.
Values outside `event`, `requestId`, `operation`, `status`, `code`, `latencyBucket`, and `samplingDenominator`
are not projected, so internal fields added later cannot leak into the log. Observation does not perform additional database
reads or writes, make network calls, or add dependencies.

This operational log line contains no path, query parameter, method, header, project ID, or publisher or administrator
identifier. Values such as project IDs and grant identifiers are product and administrative data governed by a separate contract
that stores them under a project key; the exclusions defined here apply only to this log line.

- `event`: Always `http_request`.
- `requestId`: A random UUIDv4 created for each request. It matches the `requestId` in an error response body.
- `operation`: One of `browser_collection`, `server_collection`, `administrator`, or `other`.
  Because the path is omitted, any other request is recorded only as `other`.
- `status`: The HTTP status code.
- `code`: `ok` or a fixed `ErrorCode`.
- `latencyBucket`: `lt_10ms`, `lt_50ms`, `lt_250ms`, `lt_1000ms`, `gte_1000ms`, or `unknown`.
- `samplingDenominator`: 64 for success and 1 for failure.

Sampling reduces only successful responses. Responses whose `code` is `ok` and `status` is 200 or 204 keep the 4 slots among
the 256 selected by the first two UUID characters—that is, 1/64—and record 64 in `samplingDenominator`. All other responses
are recorded regardless of status and use 1. The log level is `console.error` for 5xx, `console.warn` for 4xx, and
`console.log` for everything else.

An app log contributes at most one line for a selected response. The native Worker (`index.ts`) passes only this observation port instead of
an error-only `log` port, so lines cannot overlap for the same response. The `log` port remains available; if a host passes it,
it records only `{requestId, code}`. The observation callback is synchronous. Asynchronous observation that returns a promise is not supported.

The measured interval begins when the handler starts and ends when the response object is ready. It excludes background
work passed to `waitUntil` (such as rejection recording), network transmission, and client receipt. The clock uses an optional
`monotonicNow` port (default `performance.now()`). If the value is nonfinite or negative, no time is recorded; if the end time is earlier than
the start time, the bucket is `unknown`. The response is unaffected if the observation callback throws or the clock
call fails.

`performance.now()` in a deployed Worker advances only after I/O. These buckets are therefore a coarse distribution, not a basis for measuring CPU time,
actual total latency, or SLO compliance. Local Miniflare and Node timers differ from the deployed
clock.
Follow [Workers performance](https://developers.cloudflare.com/workers/runtime-apis/performance/).

Because success and failure sampling rates differ, calculating failure rates from raw log line counts produces distorted results. Overall
scale is approximated by multiplying success lines by 64 and failure lines by 1; that value is not an exact visitor or request count or
a percentile such as p95.

Only requests that produce a response are recorded in this log. Worker startup failures, exceptions outside request handling, requests rejected by the
platform, and configurations where the host does not pass the observation port are absent. The platform controls log collection, sampling, and truncation,
so an absent log is not evidence that no incident occurred.

## Rejection Diagnostics

Rejection diagnostics record only fixed-cause counts and the time a rejected request was received in the existing per-minute admission row.
A per-minute limit breach is recorded within the same SQL write; all other rejections are recorded once after admission passes.
The real Worker tracks post-response work with `ExecutionContext.waitUntil`. If a separate host does not provide
`waitUntil`, it awaits the work; sink errors leave the original response unchanged and do not record retry or raw error
logs. Follow [Workers waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).

Only rejection records for the most recent 7 UTC dates are retained, separate from product event and goal aggregates. The fixed
causes are `minute_limit`, `daily_limit`, `origin_denied`, `project_unavailable`, `unknown_schema`,
`invalid_request`, `invalid_event`, `event_conflict`, `attempt_conflict`, and `storage_unavailable`.
Minute and daily distinguish the scope of HTTP `quota_exceeded`. Public ingestion requests are untrusted input, and these values describe rejection of those
requests, not true visitor counts or delivery completeness. The best-effort
coverage explicitly allows for omissions, and unknown projects, administrator failures, admission database failures, and history from before
this recording feature are not aggregated. No rejection-rate denominator is provided.

Since 2026-10-23, rejected Origins before admission and optional upstream limits are written to HTTP logs
instead of being included in database diagnostics. Past `origin_denied` database records remain queryable until their retention period expires.
