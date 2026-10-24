# Local Retention and Cleanup Load Experiment

Run with `npm run bench:retained`. It accepts no arguments other than `--help`, and this 2-minute
experiment is not included in CI or the default test/check. It accepts no URL, credentials, remote
target, or existing database path. Each run creates a new D1 database and loopback listener under
the ignored `.tmp/retained-bench/run-*` path and disposes the runtime on success or failure. It
leaves the database and report for inspection.

The Worker uses the real clock. JWKS, the ephemeral signing key, and tokens exist only in memory and
do not connect to an external identity provider. It refuses to start 3 minutes before Seoul
midnight to avoid changing the retention cutoff date. HTTP requests have a 15-second limit, and the
CLI requests cancellation at 180 seconds. On cancellation or failure, it stops issuing new work,
waits for all started work, and then closes the runtime.

## Data and Load

It inserts receipts, workflow state, and daily aggregates directly with SQL into 6 synthetic
projects. This interval is excluded from HTTP measurement and does not demonstrate historical
collection throughput. The data includes rows inside and outside the retention window, and the first
four tables contain 67,860 rows in total initially.

| Table | Initial rows | Expired and removed | Newly inserted | Final rows |
| --- | ---: | ---: | ---: | ---: |
| event_receipts | 43,200 | 7,200 | 8,800 | 44,800 |
| workflow_attempts | 10,800 | 7,200 | 4,400 | 8,000 |
| event_daily_counts | 11,880 | 2,160 | 0 | 9,720 |
| workflow_daily_counts | 1,980 | 360 | 0 | 1,620 |

Aggregation increments the count of existing today rows rather than creating new rows. For 120
seconds, it issues 8 HTTP requests per second, serving 480 batch writes and 480 authenticated 30-day
summary queries. A batch contains 20 events and 10 workflow attempts, and every 12th write replays
the previous batch. The expected values are accepted 8,800, duplicates 800, and 4,400 new workflow
attempts. There is no client retry.

Actual scheduled cleanup is called 24 times every 5 seconds, faster than the production 1-minute
interval. Each run uses a maximum of 5 projects, a 500-row limit per project and table, and the real
D1 cursor. HTTP work and cleanup must overlap, and all expired rows must be removed from all 6
projects. Verify the count and timestamps of retained receipts and workflow state, compare every
aggregate row with its initial value plus accepted changes, and independently verify the final API
summary. The cursor revision must be 24.

Requests are issued on a real-time absolute schedule, and start delays are recorded separately. The
concurrency limit, including cleanup, is 16; requests above the limit fail explicitly instead of
being slowed. Any unexpected state, receipt, aggregate, or cleanup result is a failure. Success at
the given rate does not mean maximum processing capacity has been determined.

## Report and Limits

`report.json` records the environment, initial and final row counts, load window and actual time,
accepted and duplicate counts, cleanup run count, p50/p95/max for each type, issue latency, and
per-request observations. `maxInFlight` is the configured limit. Event bodies, tokens, keys, and
identities are not recorded. A failure records the last stage and completion observations in
`failure.json`. Actual execution results are in the [validation record](../../VALIDATION.md).

This experiment observes four data tables in a single local emulator for 2 minutes. Large data in
the remaining tables, long-duration load, multiple Workers, remote limits and costs, failure
recovery, and real sign-in remain unverified. Observed latency includes host, emulator, crypto, and
database work, and must not be generalized into production D1 throughput or an SLO. Success under
normal load and response to overload or failure require separate verification.
