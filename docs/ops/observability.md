# Operational Observability

Status: collector completion observability has been implemented and verified locally. Production log
collection, dashboards, alert recipients, and traces have not been deployed. The administrator
storage read probe exists only in code and has no remote execution or schedule. Actual operational
settings such as thresholds, owners, and log retention periods have not been established
(UNDECIDED).

## What Observability Exists Today

Operational observability is based on the collector application log. When a response is ready,
`request-observation.ts` writes one JSON line containing exactly seven fixed fields:
`event: http_request`, `requestId`, `operation`, `status`, `code`, `latencyBucket`, and
`samplingDenominator`. Successful responses (200 and 204) are logged for only 4/256 (1/64) of
requests selected by the first 2 characters of the UUID, with `samplingDenominator=64`. Failures are
logged in full with a denominator of 1. The log levels are `console.error` for 5xx,
`console.warn` for 4xx, and `console.log` for other responses. Cleanup task logs
(`retention_cleanup` and `retention_cleanup_failed`) also record the execution diagnostics
described below. Fields, measurement intervals, and limitations are documented in the
[logging boundary](../backend/06-logging-and-observability.md).

The Wrangler observability settings are unchanged. `observability.logs` has
`enabled`, `invocation_logs` false, and `head_sampling_rate` 1; `traces` is disabled and
`send_metrics` is false. Automatic traces and invocation logs contain request URLs, which conflict
with the product privacy contract, so they are not enabled.

## Administrator Storage Read Probe

The collector has an administrator-only `GET /v1/health` contract. It is not a public health check
and requires a verified administrator bearer. It requires a principal that passes the same
`validGrantIdentity` check as `/v1/identity`; a project grant or creator permission is not
required. Only GET is allowed, query parameters are not accepted, and the request body is not read.
The response uses `Cache-Control: no-store` and `Vary: Authorization`, and adds no CORS allow
headers.

On success, it returns only 2 fields:
`{status:'ok', scope:'administrator_storage_read'}`. It then executes a single batch with 2 reads
in D1: `SELECT 1 AS available ... LIMIT 1` against each of `projects` and `project_grants`.
An empty table still succeeds, and row contents, projects, and identities are not exposed. It does
not write to the database, collect quota, or back off under load. The meaning of `scope` extends
only to the fact that the 2 administrator control-plane tables could be read at that moment.

Failures use the existing error format. Missing, invalid, or inactive authentication returns 401
with `WWW-Authenticate: Bearer`; unsupported query parameters return 400; a non-GET method returns
405 with `Allow: GET`; and a D1 read failure or disconnected host probe returns 503 with
`Retry-After: 1` and `{error:{code,message,requestId}}`, preserving the existing correlation ID.

Success does not prove collection writes, aggregation accuracy, all 16 tables, Cron, log
completeness, or overall service health. Native `createWorker` connects the
`admin.checkReadiness` port when a verifier is present. If the host does not pass
`admin.checkReadiness` to `createCollector`, the endpoint always returns 503
`storage_unavailable`. Only the local code implementation exists today, so there is no production
probe schedule, real-provider OIDC, alert recipient, or remote deployment. This contract has
completed local verification, and the results are in [VALIDATION.md](../../VALIDATION.md).

The administrator application's settings screen contains a **Storage Read Check** panel that calls
this endpoint manually. Expanding the panel does not send a request; one click makes one call, and
there is no automatic polling or display of JSON or identifiers. On success, it shows the time of
the current check, which is not a metric-refresh time. On failure, it shows only an error message
and removes the success indication. Closing the panel or replacing the connection cancels the
request and discards late responses. Requests are cancelled after 5 seconds and can be retried
manually. Normal, failure, malformed-response, timeout, reconnection, and 320px screen cases were
verified with Chrome, ephemeral signed OIDC, and local D1. A real OIDC provider and remote-state
verification are still absent; results are in [VALIDATION.md](../../VALIDATION.md).

## Evidence Available Today

- Group by fixed fields to view frequencies for each `operation`, `status`, and `code`, and the
  `latencyBucket` distribution.
- Separate 4xx responses (input, authorization, and configuration problems) from 5xx responses
  (storage and server problems) to identify surges.
- A `requestId` on an error response body is also present in the log line, so you can select a
  response and compare its body with the corresponding log entry.

`latencyBucket` is a coarse distribution. On a deployed Worker, `performance.now()` advances only
after I/O, so it is not CPU time or total real latency and cannot be used to judge an SLO. Local
timers differ from deployed clocks.

## Log Summary Tool

**Operational Log Report** in administrator settings reads this tool's v2 JSON file inside the
browser and displays it as a table. It distinguishes observation counts, weighted request estimates,
diagnostics, HTTP response and latency buckets, and cleanup run and processed-operation counts. It
does not upload or save the file, and it enforces an 8 MiB limit, aggregate validation, pagination,
and clearing on close or reconnection. Log acquisition and remote monitoring are separate concerns;
usage and scope are documented in the [local report guide](local-report-viewer.md).

```powershell
Get-Content app-log.ndjson | node tools/runtime/summarize-observations.ts --stdin
```

The tool counts the `http_request` lines it derives directly from application NDJSON on standard
input and emits one JSON document with observation counts and weighted estimates for each
`operation`, `status`, `code`, and `latencyBucket`. It does not include `requestId` or
source text in the output and performs no queries, file writes, or network access. On Windows, use
`node` directly or the `npm.cmd` alias instead of piping through `npm.ps1`. The contract and
limitations are in the [log summary guide](../../tools/runtime/LOG-SUMMARY.md).

Captured Wrangler tail JSON is read with `--stdin --wrangler-tail`. The tool validates and
aggregates only a single console JSON string from a multi-line object and discards URLs, headers, and
exceptions. It does not correct for additional platform sampling or omissions, and it rejects input
with `no_observations` when there are no application observations. This path also reads only local
input and does not open a remote session. The limits and the meaning of report input count are in
the guide above.

`coverage` is limited to the application log lines received, and
`exactRequestCounts`, `latencyPercentilesAvailable`, and `timeWindowAvailable` are always false.
Observed response counts and weighted estimates are different, and neither is evidence for a
failure rate, p95, or an SLO.

The same tool joins cleanup logs on standard input by `runId`. `attempted` is the sum of project
attempts; `completed` is the number of successful cleanup calls, not deleted rows; and
`cursorAdvanced=true` does not mean that no project failed. Runs without a detailed report remain
unobserved. When only cleanup records exist, the tool reports normally with
`observedResponses=0`. `cleanup.reportedRuns` is the scope for processed-operation aggregation,
and `cleanup.reportlessFailureRuns` is the number of failed runs whose details are missing. Review
`cleanup.failedProjects`, `cursorNotAdvancedReports`, and `failureMarkerRuns` together, but do
not add overlapping run counts to produce a total failure-run count.

The report includes an additive `diagnostics` object
(`tallyfin.observation-diagnostics/v1`). `serviceHealth` is always `unknown`, and
`coverage` separates http, cleanup, cleanupDetails, and otherLogsIgnored. `findings` contains
`error` and `review` items with `observedCount` and fixed `action` codes, and each HTTP
response belongs to at most one item. `cleanup_failures` is the union of unique `runId` values for
runs with a failure marker, `failed>0`, a cursor conflict, cancellation, or a storage error, and it
can overlap with `cleanup_report_missing`. `observedCount` is an observation count, not a weight
or failure rate, and items with 0 observations are omitted, so 0 errors is not evidence that the
service is healthy. A 4xx `review` can be a normal protective response. CLI options, limits, and exit
codes are unchanged, and there is no alerting, network access, or thresholding.

## Evidence Not Available Today

A failure ratio cannot be calculated directly from log line counts. Successes are sampled at 1/64
and failures are logged in full, so counting them together would distort the result. Overall scale
is estimated as successful lines × 64 + failed lines × 1; that value is not an exact visitor or
request count and is not a percentile such as p95.

The absence of logs does not prove that no incident occurred. The application attempts to log every
failed response, but platform log collection, sampling, and truncation can reduce the record.
Worker startup failures, exceptions outside request handling, requests rejected by the platform,
and configurations where the host does not pass the observability port are not logged. If an
observability callback fails, only that line disappears while the response is unchanged, and there
is no path that reports the callback failure itself.

No production alert recipients, dashboard, or log retention period has been deployed. The
administrator read probe exists only in code and has no remote execution or schedule. Thresholds and
owners are not established and must not be invented (UNDECIDED).

## Alerting Design Rationale

The local `monitor:access` command runs the 3 existing authentication access checks once per
invocation and uses a state file to detect consecutive failures and recovery. It takes an explicit
failure threshold and allowed observation interval and emits `notify=true` only when a problem
opens or recovers. It does not connect actual alert delivery, periodic execution, or token issuance
and refresh. Its inspection scope covers administrator access and reads of the 2 control tables. For
CLI, locking, and output-loss limitations, see
[repeated access monitoring](../../tools/runtime/ACCESS-MONITOR.md).

Thresholds, recipients, and suppression rules will be finalized after operational resources and
owners are assigned. Until then, the available evidence is the fixed-field groups above. Examples
include a surge in 5xx responses grouped by `operation`, `status`, and `code`, or an increase in
specific codes such as `storage_unavailable`, `quota_exceeded`, and `origin_denied`. Which groups
trigger alerts, at what values, and where notifications go are UNDECIDED.

Observability logs are only part of the evidence. Rejection diagnostics retain fixed per-project
per-minute and per-day reasons for the most recent 7 UTC dates and do not provide a rejection-rate
denominator. Incident investigation records and retention policy follow
[incident response](./incident-response.md) and the
[operational contract](./00-operational-contract.md), and actual figures and owners will be aligned
when those documents are finalized.

## Validation

- Required validation names: [VALIDATION.md](../../VALIDATION.md)
- Release blocking status: UNDECIDED
- Remaining operational risk: UNDECIDED

## Cleanup Throughput Observability — 2026-10-23

Cleanup logs and the optional report `metrics` contain deletedRows, saturatedTables,
oldestExpiredReceiptAgeMs, measuredProjects, and capacityLimitedProjects. Duplicate logs are summed
once, and the maximum is retained for the oldest delay. Past logs that were not measured are not
turned into 0. The delay reflects only expired receipts remaining in projects that were processed
successfully, and reaching a deletion limit is not a definitive indication of a backlog. Logs from
up to 20 projects are still read.

## Cleanup Execution Latency and Interruption Reasons

New retention_cleanup logs record elapsedMs, stopReason, interruptedProjects, and
checkpointedProjects under execution, and scheduled runs also record scheduleLagMs. Execution time
is a floored millisecond value based on performance.now(). Because of Worker clock constraints, do
not interpret it as CPU time, total real latency, or an SLO. Schedule lag is the difference between
the wall-clock time at run start and scheduledTime, with future schedules clamped to 0. The deletion
cutoff continues to be based on the scheduled time.

stopReason is one of page_limit, time_budget, cycle_complete, empty_page, cursor_conflict,
cancelled, or storage_error. Per-project cleanup failures are counted separately in failed.
page_limit and time_budget mean work was carried over and do not guarantee success or deletion of
all expired data. interruptedProjects is the number of operations whose result could not be
confirmed; it does not mean that no deletion occurred. checkpointedProjects is traversal progress
confirmed by CAS and can include failed projects.

During an exception or cancellation, the final report and failure marker for the same runId are both
recorded, and the summarizer counts them as one run. Past logs without execution are still read, but
their time and reason fields are not filled with 0. Failure classification for past logs keeps the
existing criterion of a cursor that did not advance. For new logs, time carry-over alone does not
create a failure from a non-advancing cursor. Execution validation checks closed fields, count
totals, and ranges, and rejects the input without producing a partial report when fields contradict
each other or contain private data.

The summary report's cleanup.execution provides the number of runs with diagnostics, the number of
runs by interruption reason, the number of interrupted operations, confirmed cursor progress, and
the maximum observed execution time and schedule lag. It keeps a separate schedule-lag sample count.
This scope covers only the supplied logs; a mix of older logs may not represent all runs. The tool
does not add source errors, project IDs, configuration, or the scheduled time itself to logs or the
report.
