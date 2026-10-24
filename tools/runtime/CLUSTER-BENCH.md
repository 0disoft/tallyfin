# Local Collection Cluster Load Experiment

Run with `npm run bench:cluster`. It accepts no arguments, or only `--help` and `--soak`. This
experiment is not included in CI or the default test/check. It accepts no URL, credentials, remote
target, or existing database path. Each run creates a new D1 database and loopback listener under
the ignored `.tmp/cluster-bench/run-*` path and disposes the runtime in a finally block regardless
of success or failure. It leaves D1 and the report for inspection.

## Profiles

With no argument, it runs the 120-second default profile; `--soak` runs the 600-second soak
profile. Both use the same topology, initial data, and publishing rate per second; they differ only
in observation window and resulting totals. Soak is also fixed at 10 minutes, with no option to
increase or decrease the window separately.

| Profile | Window | Waves (2-second interval) | HTTP requests | Cleanup calls | accepted | duplicates | Workflow attempts and funnel runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Default | 120 seconds | 60 | 900 | 24 | 3,600 | 7,200 | 600 |
| `--soak` | 600 seconds | 300 | 4,500 | 120 | 18,000 | 36,000 | 3,000 |

Both profiles publish 7.5 events per second. The CLI requests cancellation after the window plus
60 seconds (180 seconds default, 660 seconds soak). On cancellation or failure, it stops issuing new
work, waits for all started work, and then closes the runtime.

Inside one Miniflare/workerd, 3 collection Workers and one loopback router start. The router forwards
`/worker/0/...` through `/worker/2/...` to the corresponding collection Worker and rejects other
paths with 404. All three Workers bind the same new D1 ID, and the `X-Tallyfin-Bench-Worker`
response header identifies the actual execution instance. The Worker uses the real clock. If adding
the whole profile duration (window plus 60 seconds) to the start time crosses into another date, the
run refuses to start so that the Seoul midnight retention cutoff does not change. HTTP requests have
a 15-second limit.

## Tokens

JWKS, ephemeral signing keys, and tokens exist only in memory and do not connect to an external
identity provider. Tokens live for 5 minutes, and administrator and publisher readers refresh from
30 seconds before expiration. Concurrent requests from the same reader share one in-flight signing
result. The report records only the issuance count in `tokenIssuances`; it records no token values,
keys, or identities. The soak profile requires at least 3 administrator and 3 publisher issuances,
while the 2-minute default profile does not check this lower bound.

## Data and Load

The benchmark inserts receipts, workflow state, and daily aggregates directly with SQL into 6
synthetic projects (`load-00` through `load-05`). This interval is excluded from HTTP measurement
and does not demonstrate historical collection throughput. Both profiles start with the same 148,260
rows across the first six tables.

| Table | Initial rows |
| --- | ---: |
| event_receipts | 67,200 |
| workflow_attempts | 67,200 |
| event_daily_counts | 11,880 |
| workflow_daily_counts | 1,980 |
| funnel_runs | 0 |
| funnel_daily_counts | 0 |

Each project receives 10,000 receipt rows with 1,200 expired, and 10,000 workflow-attempt rows with
1,200 expired. Event aggregates contain 3 tools × 6 registered events × 90 days plus the preceding
20 days, for 1,980 rows per project. Workflow aggregates contain 3 tools × 110 days, for 330 rows.
The two funnel tables are populated only for the funnel project during load.

After cleanup, the load projects lose 7,200 expired receipts, 7,200 expired workflow attempts, and
aggregates older than 90 days (2,160 event_daily_counts rows and 360 workflow_daily_counts rows).
This initial cleanup count is the same in both profiles. Accepted workflow batches add per project
200 receipts and 100 workflow attempts in the default profile, and 1,000 receipts and 500 attempts
in soak.

The mixed funnel project (`cluster-funnel`) is registered separately with a 600-request-per-minute
limit. Browser batches record `file_selected` and `upload_finished`, and server batches record
`job_started` and `job_finished` for the same 10 execution IDs. Browser and server stages merge into
the same execution, but HTTP arrival order is not guaranteed. Expected funnel run rows equal each
profile's funnel run count (600 default, 3,000 soak), and four-stage reached counts equal the run
count.

Waves are issued every 2 seconds, 60 in the default profile and 300 in soak. Each wave sends a
20-event workflow batch (10 workflow attempts), a 20-event browser funnel batch, and a 20-event
server funnel batch to all 3 collection Workers with the same body. It also reads 3 authenticated
summaries and 3 funnel daily aggregates. That makes 9 writes plus 6 reads, or 15 HTTP requests per
wave and 7.5 per second. Sending the same body to 3 Workers at once means one accepts it and the
others respond as duplicates. Expected values are accepted 3,600 and duplicates 7,200 in the
default profile, and accepted 18,000 and duplicates 36,000 in soak; the resulting new workflow
attempt rows and funnel runs are 600 default and 3,000 soak. Workflow batches spread across the 6
load projects, while funnel batches go only to the funnel project. Existing today aggregates in load
projects increment their counts, and the funnel project creates 8 source-event aggregate rows and 8
stage aggregate rows.

Actual scheduled cleanup runs every 5 seconds rather than every 1 minute, assigned round-robin across
the 3 Workers. It runs 24 times by default and 120 times in soak and must overlap HTTP work. At the
end, all expired receipts and workflow attempts and aggregates older than 90 days are gone, and the
cursor revision equals the number of cleanup calls.

## Verification

Verify per instance that all 3 collection Workers read the same D1 database, and compare per-project
receipt and workflow-attempt counts with initial values plus accepted work. Compare every aggregate
row with its initial value plus accepted changes. Verify that funnel stage reached counts equal each
profile's funnel run count, and that each Worker's funnel summary has `startedRuns` and
`completedRuns` equal to that count and a 100% completion rate. Any unexpected state, receipt,
aggregate, or cleanup result is a failure.

Requests are issued on a real-time absolute schedule, and start delays are recorded separately. The
concurrency limit, including cleanup, is 16; requests above it fail explicitly rather than slowing
down. The actual maximum concurrent HTTP execution count is recorded in `peakHttpInFlight`, and the
number of times cleanup overlapped HTTP work is recorded in `cleanupOverlappedHttp`. Success at the
given rate does not mean maximum processing capacity has been determined.

## Report and Limits

`report.json` records `profile`, the window, environment, initial and final row counts, load window
and actual time, accepted and duplicate counts, cleanup run count, p50/p95/max by type, issue
latency, token issuance count, and per-request observations. `maxInFlight` is the configured limit
and `peakHttpInFlight` is the actual maximum. Event bodies, tokens, keys, and identities are not
recorded. A failure records the last stage and completion observations in `failure.json`. Record
actual execution results and pass status in the [validation record](../../VALIDATION.md).

Environment setup follows the
[Cloudflare Miniflare guide for multiple Workers](https://developers.cloudflare.com/workers/testing/miniflare/core/multiple-workers/)
and the installed Miniflare binding API.

This experiment observes 3 separated collection Workers inside a single local emulator for 120
seconds (default) or 600 seconds (soak). The observation window is the actual time of the run
profile; throughput figures are neither regional characteristics nor a multi-day soak. Multi-process
and multi-region operation, long-duration load, remote limits and costs, failure recovery, and real
sign-in remain unverified. Observed latency includes host, emulator, crypto, and database work and
must not be generalized into production D1 throughput or an SLO. Success under normal load and
response to overload or failure require separate verification.
