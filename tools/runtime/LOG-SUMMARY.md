# Application Log Summary — `logs:summary`

```powershell
# PowerShell example: pipe application logs directly into node
Get-Content -LiteralPath app-log.ndjson -Encoding utf8 | node tools/runtime/summarize-observations.ts --stdin

# npm alias (npm.cmd on Windows). Pass input through a pipe
Get-Content -LiteralPath app-log.ndjson -Encoding utf8 | npm.cmd run --silent logs:summary -- --stdin
```

The command aggregates application logs (NDJSON) from standard input and writes one JSON document
to standard output. The default invocation is `--stdin`, and Wrangler input uses
`--stdin --wrangler-tail`. Anything else is `invalid_arguments`. `--help` prints usage without
reading input. It accepts no file argument, URL, target configuration, or credentials, and performs
no network access, Cloudflare export, or file write.

The path piped through PowerShell's `npm.ps1` wrapper failed in the local smoke test (exit code 1,
no CLI report). Do not treat that path as verified; use node directly or the `npm.cmd` alias. A
non-silent `npm run` mixes in its banner, so producing exact JSON on stdout requires `--silent`.

## Input Contract

- Non-interactive (not TTY) standard input, UTF-8, one JSON record per line. TTY input returns
  `stdin_required`.
- Limits: 8 MiB raw stream, 50,000 physical lines (including blank and ignored lines), 16 KiB per
  line, and a 30-second input deadline.
- The line budget adds 1 newline byte per line, including a final line without a newline. The 8 MiB
  raw-stream limit is a separate budget.
- CRLF and UTF-8 sequences split across chunks are reassembled. Malformed or truncated UTF-8 returns
  `invalid_log`.
- A record whose `event` is `http_request` must contain exactly the 7 fixed fields: `event`,
  `requestId`, `operation`, `status`, `code`, `latencyBucket`, and `samplingDenominator`.
  Extra or missing keys and invalid formats return `invalid_log`.
- Cleanup logs described below and JSON objects that are not `http_request` are ignored and counted
  in `ignoredOtherLogLines`. Non-object JSON values such as strings, numbers, `null`, and arrays
  return `invalid_log`. Platform wrappers (such as `{logs:[...]}`) are not unwrapped in default
  mode.
- Blank lines are counted in `blankLines`.

## Wrangler Tail JSON Input

This reads a finite JSON log already captured locally. The command does not open a remote log
session.

```powershell
Get-Content -LiteralPath tail-log.json -Encoding utf8 |
  node tools/runtime/summarize-observations.ts --stdin --wrangler-tail
```

- It is based on the `tail --format json` output structure of installed Wrangler 4.148.0. Objects
  are separated by whitespace or newlines. It supports multi-line JSON, CRLF, single-line objects,
  and UTF-8 split across chunks. It rejects JSON arrays, human-readable pretty logs, and input mixed
  with banners or error text.
- Each object must have a `logs` array, and each log must have a `message` array. The application
  writes one JSON string to console. Only `http_request` and cleanup records in that string enter
  the existing validation and deduplication. A known application record sent as an object or
  multiple arguments is rejected, as is malformed JSON starting with `{`.
- Unrelated console records are replaced with one empty object for counting ignored records, and
  their content is discarded. The report's `input.lines` is the number of processed console records,
  not physical lines or Worker runs. URLs, headers, exceptions, script names, and timestamps from
  wrapper objects are excluded from the report and errors. The source file may contain that
  information, so store it outside the repository and do not put source text into the administrator
  UI.
- In addition to the overall 8 MiB and 30-second limits, it limits each object and physical line to
  256 KiB, nesting to 64 levels, and objects and physical lines to 50,000. Application records also
  use the existing 16 KiB, 50,000, and 8 MiB budgets. A limit, format, or conflict failure produces
  no partial report. The report is emitted only after standard input ends, so an open tail pipe ends
  with `input_timeout` after 30 seconds.
- The report remains v2 and can be read directly in the local report view in administrator settings.
  Because tail data can have additional sampling or omissions, the weighted request estimate must
  not be treated as a guaranteed estimate of all traffic. If only platform exceptions are present
  and no application records exist, the result is `no_observations`. Do not treat it as healthy.

Format evidence:
[Cloudflare real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
and the `jsonPrintLogs` and `logs[].message` output code in `src/tail/printing.ts` from the
installed Wrangler. Capturing real production logs and opening a remote session have not been run.

## Duplicates and Rejection

- If normalized fields for the same `requestId` match, the line is counted in
  `duplicateLogLines` and aggregated once. Different key order or UUID case still counts as equal.
- If fields with the same `requestId` differ, the entire report is rejected with
  `request_conflict`.
- Duplicates of the same cleanup record type are included in `duplicateLogLines`. A detailed report
  and a failure marker are different types.

## Failure Codes

Input validation failure produces no partial report on stdout; the report is written only once after
EOF. Input failure leaves stdout empty, writes one line `{"code":"..."}` to stderr, and exits with
a code other than 0. However, `output_unavailable` (a stdout write failure) can mean the stream closed
mid-write, so stdout cannot be guaranteed empty. The receiver must check both the exit code and
whether the JSON is valid.

| Code | Meaning |
| --- | --- |
| `invalid_arguments` | Mismatched options |
| `stdin_required` | TTY input |
| `invalid_log` | Format, extra-field, or UTF-8 error |
| `input_limit` | Stream bytes, line count, or line length exceeded |
| `request_conflict` | Field conflict for the same UUID |
| `no_observations` | No HTTP or cleanup logs to aggregate |
| `run_conflict` | Detailed cleanup reports for the same runId differ |
| `input_timeout` | 30-second input deadline exceeded |
| `input_unavailable` | Input stream error or early termination |
| `output_unavailable` | Standard-output write failure, such as a closed pipe |

## Output

The output is `schemaVersion: tallyfin.observation-summary/v2` JSON. This marks a report shape and
recognition change, not a package version bump. It contains no `requestId`, project IDs, raw
`runId`, or paths.

| Field | Meaning |
| --- | --- |
| `coverage` | `provided-app-log-lines-only` |
| `exactRequestCounts`, `latencyPercentilesAvailable`, `timeWindowAvailable` | Always false |
| `input` | `lines`, `blankLines`, `ignoredOtherLogLines`, `duplicateLogLines` |
| `observedResponses` | Number of observed response lines after removing duplicates |
| `weightedRequestsEstimate` | Successful logs × 64 + other logs × 1 |
| `operations` | Totals and `responses` (status and code) by `operation`, plus `latencyBuckets` |
| `cleanup` | Run, project-processing, and cursor-progress aggregates described below |
| `diagnostics` | Additive diagnostic object described below (`tallyfin.observation-diagnostics/v1`) |

## Cleanup Logs

A scheduled application run writes one line:
`{runId, code: 'retention_cleanup', attempted, completed, failed, cursorAdvanced}`. If
`failed>0` or `cursorAdvanced=false`, it writes a marker for the same `runId`:
`{runId, code: 'retention_cleanup_failed'}`. If an exception occurs before the report, only the
marker remains. Logs can be reordered, duplicated by export, or omitted.

- The tool joins detailed reports and markers by `runId` (UUIDv4). Duplicate records of the same
  type are counted once, and a marker and a detailed report complement each other rather than being
  duplicates or conflicts. Different detailed reports for the same `runId` reject the entire report
  with `run_conflict`.
- Validation: detailed reports have 6 fields (`runId`, `code`, `attempted`, `completed`,
  `failed`, `cursorAdvanced`), and markers have 2 (`runId`, `code`). `attempted`, `completed`,
  and `failed` are integers from 0 to `CLEANUP_RUN_PROJECT_LIMIT` (currently 20; default runs
  process 5), `completed + failed = attempted`, and `cursorAdvanced` is boolean.
- Counts are per run, not per project. `attempted` is the sum of project attempts, so the same
  project can appear multiple times. `completed` is the number of successful cleanup calls, not the
  number of deleted rows or proof that all expired data was removed. `cursorAdvanced=true` also does
  not mean no project failed.
- A run without a detailed report remains unobserved and is not converted to a successful 0. Totals
  cover only runs that have detailed reports.
- When cleanup records exist and no `http_request` records do, the tool reports normally with
  `observedResponses=0`; when both are absent, it returns `no_observations`.

`cleanup` contains only the following fixed fields. If only HTTP logs exist, all are 0.

| Field | Meaning |
| --- | --- |
| `observedRuns` | Unique runs with a detailed report or failure marker |
| `reportedRuns` | Runs for which a detailed report was observed |
| `failureMarkerRuns` | Runs with a failure marker (can overlap detailed reports) |
| `reportlessFailureRuns` | Runs with only a failure marker and no detailed report |
| `attemptedProjects`, `completedProjects`, `failedProjects` | Attempt, success, and failure totals from detailed reports |
| `cursorAdvancedReports`, `cursorNotAdvancedReports` | Detailed reports with cursor advanced or not advanced |

Project-processing and cursor totals include only `reportedRuns`. If
`reportlessFailureRuns>0`, processing for those runs is unknown, so `failedProjects=0` does not
establish that no project failed. Even when a marker is absent, check `failed>0` or
`cursorAdvanced=false` in the detailed report.

## Diagnostics

`diagnostics` is added additively to report v2. Its `schemaVersion` is
`tallyfin.observation-diagnostics/v1`, and `serviceHealth` is always `unknown`. Do not determine
service health from observed logs alone.

| `coverage` | Value |
| --- | --- |
| `http` | `observed` or `unobserved` |
| `cleanup` | `observed` or `unobserved` |
| `cleanupDetails` | `complete_for_observed_runs`, `partial_for_observed_runs`, or `unobserved` |
| `otherLogsIgnored` | boolean |

The `cleanupDetails` value `complete_for_observed_runs` means details exist for the observed runs; it does not guarantee that
every Cron run or all host logs were seen.

`findings` is an array of items, each containing `code`, `severity` (`error` or `review`),
`operation` (`RequestOperation` or `retention_cleanup`), `unit` (`responses` or `runs`),
`observedCount`, and `action` (a fixed code).

| code | Condition | severity and unit | action |
| --- | --- | --- | --- |
| `storage_errors` | HTTP 5xx with `storage_unavailable` | error and responses | `inspect_storage` |
| `server_errors` | Other HTTP 5xx | error and responses | `inspect_collector` |
| `collection_quota_rejections` | 429 `quota_exceeded` on a collection path (`browser_collection` or `server_collection`) | review and responses | `review_collection_limits` |
| `collection_configuration_rejections` | 4xx `origin_denied`, `project_unavailable`, or `unknown_schema` on a collection path | review and responses | `review_collection_configuration` |
| `access_denials` | 401 or 403 with `unauthorized` or `forbidden` | review and responses | `review_access_configuration` |
| `request_rejections` | Other 4xx | review and responses | `review_request_contract` |
| `cleanup_failures` | Defined below | error and runs | `inspect_retention_cleanup` |
| `cleanup_report_missing` | Failed runs without detailed reports | review and runs | `inspect_cleanup_log_coverage` |

- The `operation` of an HTTP item is the response's `operation`, and each HTTP response belongs to
  at most one item. Collection paths are only `browser_collection` and `server_collection`, so 429
  and 4xx responses for `administrator` and `other` are classified as `request_rejections` or
  `access_denials`, not collection items.
- `cleanup_failures` is the union count of unique `runId` values with a failure marker,
  `failed>0`, or `cursorAdvanced=false`.
- `cleanup_report_missing` is the number of failed runs without detailed reports and can overlap
  `cleanup_failures`. Do not add the two to produce a total failed-run count.
- `observedCount` is an observation count, not a weight or failure rate. Items with 0 observations
  are omitted, so no items does not mean the service is healthy, and 0 errors is not healthy
  evidence.
- A 4xx `review` item can reflect normal protective behavior or an intended rejection, so it is not
  an outage alert.

CLI behavior is unchanged. Options, input limits, and exit codes do not change, and even with an
`error` item the exit code is 0 when input aggregation succeeds. There is no alert delivery,
network access, time window, or thresholding.

## Interpretation Limits

- `observedResponses` and `weightedRequestsEstimate` are different. The latter is a weighted
  estimate, not an exact request count.
- Failure rate, p95, end-to-end latency, and SLO judgments cannot be produced. `latencyBucket` is
  a coarse distribution.
- Platform sampling, truncation, and duplicate export limit interpretation. There is no built-in
  time interval or interval comparison.
- The absence of logs does not prove that no incident occurred. Field, measurement interval, and
  limitation details follow [the logging boundary](../../docs/backend/06-logging-and-observability.md)
  and [operational observability](../../docs/ops/observability.md).

## Burden and Evidence

- The application emitter (`apps/collector/src/request-observation.ts`) is unchanged and creates
  no additional logs.
- The first slice added the CLI tool and package script; this extension changes the aggregator,
  checks, and documentation. Collector, API, database, SDK, and environment variables did not
  change, and neither did CI workflows or dependencies. No remote automation was run, and no
  performance figures are claimed.
- The root default test glob includes this tool's 20 checks (9 aggregator, 4 diagnostics, and 7 CLI).
- Field and sampling rules are in
  [the logging boundary](../../docs/backend/06-logging-and-observability.md).

## Cleanup Throughput Observability — 2026-10-23

Cleanup logs and the optional report `metrics` contain deletedRows, saturatedTables,
oldestExpiredReceiptAgeMs, measuredProjects, and capacityLimitedProjects. Duplicate logs are summed
once, and the maximum is retained for the oldest delay. Past logs that were not measured are not
turned into 0. The delay reflects only expired receipts remaining in projects that were processed
successfully, and reaching a deletion limit is not a definitive indication of a backlog. Logs from
up to 20 projects are still read.
