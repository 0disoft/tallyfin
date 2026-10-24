# Server SDK Recovery Verification — `verify:server-recovery`

```powershell
npm run verify:server-recovery
```

This command supports only `--help`. It accepts no options for an endpoint, target, credentials, or
existing database path, and rejects any argument other than `--help` and exits with code 1. It is not
part of CI or `npm run check`, so run it directly when needed. Every run creates only a new synthetic
environment and does not connect to an existing or remote database or an external publisher.

It uses `@tallyfin/server` without injection, so the SDK's default platform (real `fetch`, timers,
and `crypto`) sends requests over a real loopback socket. A single run verifies only "whether a retry
after failure sends the same bytes again, and whether the collector filters out the duplicate."

This document follows the current code in `tools/runtime/server-recovery.ts`,
`tools/runtime/collector-harness.ts`, and `packages/server/src/index.ts`, and appends the result of
one local run at the end.

## Execution Structure

Each run creates `.tmp/server-recovery/run-<random>/` and stores its state there.

- `collectorHarness(dir, undefined, 3)` starts 3 Miniflare collectors, `collector-0`, `collector-1`,
  and `collector-2`, sharing one `DB`. A new database ID is generated with
  `crypto.randomUUID()` every run.
- Publisher and administrator tokens are signed only with an RS256 key pair generated in memory on
  each run and a synthetic JWKS. There is no external publisher sign-in, JWKS lookup, or token
  refresh. The SDK's `getToken` returns this in-memory token on every call, and the SDK does not
  store the token.
- The relay starts a `node:http` server on a random port at `127.0.0.1`. The endpoint seen by the
  SDK is
  `http://127.0.0.1:<port>/v1/projects/recovery-funnel/server-batches`, and it is given
  `allowLocalHttp: true` because it is loopback.
- The browser seed is sent directly to `collector-0` with `POST`, bypassing the relay, and adds
  `file_selected` and `upload_finished` (200, accepted 2). Server stages `job_started` and
  `job_finished` follow with the same `runId` to complete 4 stages.
- The synthetic registry reverses the allowed `job_finished.kind` ordering and checks whether the
  SDK accepts the same set that Core recognizes over the actual transport. The original example file
  is unchanged.

The relay returns 404 unless the request is a `POST` to the exact path, and 413 when the body exceeds
16 KiB. It computes only a SHA-256 of each received body and stores that in a memory array; it never
exposes the body itself. Accepted requests are forwarded in order to `collector-(n % 3)`. It verifies
that the `X-Tallyfin-Bench-Worker` header set by the collector matches the intended name and that the
response body is at most 1024 bytes.

## Two Fault Stages

In each stage the SDK calls `send()` once, and the result must exactly match the table below.

| Stage | Relay behavior | SDK result |
| --- | --- | --- |
| `before-commit` | Treats the first request as not committed and returns `503` plus `Retry-After: 1` | Retry succeeds: `delivered`, accepted 2, duplicates 0, attempts 2 |
| `after-commit` | Forwards the first request to one collector and receives a `200` ack, then closes only the client socket | Retry of the same body goes to another collector: `delivered`, accepted 0, duplicates 2, attempts 2 |

In both stages, exactly 2 SDK bodies reach the relay, and their SHA-256 values must be equal. This
verifies that the retry sent the same bytes again. In after-commit, the collector used by the retry
must differ from the one that received the first delivery.

## Meaning of Socket Loss After Commit

The socket termination in the after-commit stage is deliberately arranged so that the collector
finishes the commit and sends a 200 ack, but the response does not return to the client. The client
treats it as a failure and sends the same body again, and the second attempt is reduced to 2
duplicates.

This does not simulate a power failure or forced process termination, and it does not mean a durable
outbox or exactly-once delivery was added to the relay or client. It verifies that collector-side
duplicate removal works during retry and that the same body remains intact for retry.

## Integrity Checks and Publisher Revocation

After both stages, the command checks the following directly with D1 SQL.

- Grouping `event_daily_counts` by `source` and `event_name`, `SUM(count)` is 2 for all four
  registered events (`file_selected`, `upload_finished`, `job_started`, and `job_finished`).
- `event_receipts` has 8 rows (2 browser plus 2 server per stage).
- `funnel_runs` has 2 rows, both with `json_array_length(step_times_json)` equal to 4 and all stage
  timestamps populated without null.
- `funnel_daily_counts` has `reached_count` 2 for every `step_index` from 0 through 3.
- After the publisher grant is revoked, `send()` ends as `rejected`, httpStatus 403, attempts 1,
  retryable false.
- The relay then receives 1 body, and the `event_daily_counts` snapshot and 8 `event_receipts` rows
  are unchanged from before revocation.
- Administrator reads remain available after publisher revocation. All three collectors return 200
  for `funnels/conversion/daily` with `startedRuns` 2, `completedRuns` 2, and `completionRate` 100.

## Budget and Shutdown

- The SDK request timeout is 5 seconds (`requestTimeoutMs`), retry budget is 15 seconds
  (`retryBudgetMs`), and maximum attempts is 3 (the default). The timeout covers credential
  acquisition, the request, and response-body reading.
- The relay's own `requestTimeout` and `headersTimeout` are each 15 seconds.
- The CLI applies a 60-second total budget and can be interrupted with `SIGINT` or `SIGTERM`.
- Cleanup happens in `finally`. It closes the relay with `closeAllConnections()` followed by
  `close()`, awaits all in-flight request promises, and then disposes the runtime with
  `mf.dispose()`. Failure follows the same path.

## Report

It writes `tallyfin.server-recovery/v1` JSON to `report.json` in the run directory (`wx`, so it
fails if the file already exists). The CLI writes the same JSON to standard output with an added
`output` field pointing to the run directory. On failure, it leaves `failure.json`, writes a message
containing `phase` and the path to stderr, and exits with code 1. `phase` is one of `provision`, a
stage name, or `verify-and-revoke`.

| Field | Value |
| --- | --- |
| `local`, `syntheticData`, `verified` | true |
| `defaultSdkFetch` | true (the SDK platform is not injected) |
| `workerCount` | 3 |
| `existingDatabasesAccessed`, `remoteChanges` | false |
| `responseLoss` | `socket-closed-after-verified-commit` |
| `results` | Per-stage `{ mode, status, accepted, duplicates, attempts }` |
| `denied` | `{ attempts: 1, httpStatus: 403 }` |
| `receipts`, `completedRuns` | 8, 2 |
| `unchangedAfterDenial`, `byteIdenticalRetries` | true |
| `observations` | Relay records `{ mode, upstreamStatus, worker, responseLost }` |

The report contains no bodies, tokens, credentials, or source identifiers. Body SHA-256 values remain
only in diagnostic memory and do not enter the report.

## Execution Result

`npm.cmd run verify:server-recovery` was run locally on Windows and exited with code 0, with
`verified: true` in the report (result file
`.tmp/server-recovery/run-yHHyGG/report.json`). The following values were observed.

- `local`, `syntheticData`, `verified`, and `defaultSdkFetch` were all true, `workerCount` was
  3, `existingDatabasesAccessed` and `remoteChanges` were false, and `responseLoss` was
  `socket-closed-after-verified-commit`.
- before-commit: the first request returned `503` plus `Retry-After: 1`, and the retry ended with
  accepted 2, duplicates 0, and attempts 2.
- after-commit: the first delivery was stored by one collector and received a `200` ack before only
  the client socket was closed. The retry went to another collector and finished with accepted 0,
  duplicates 2, and attempts 2.
- In both stages, the SDK bodies that reached the relay had the same SHA-256
  (`byteIdenticalRetries` true).
- Each stage included 2 browser seeds plus 2 server events, so `event_daily_counts` had
  `SUM(count)` equal to 2 for each of the four events, `event_receipts` had 8 rows,
  `funnel_daily_counts` had `reached_count` 2 for steps 0 through 3, and `completedRuns` was 2.
- `funnel_runs` had 2 rows, and both had 4 non-null stage timestamps in `step_times_json`.
- After revoking the publisher grant, `send()` ended with 403, attempts 1, retryable false, and the
  1 body received by the relay left aggregates and 8 receipts unchanged from before revocation
  (`unchangedAfterDenial` true). Administrator reads still returned 200 from all 3 collectors with
  `startedRuns` 2, `completedRuns` 2, and `completionRate` 100.
- `--help` exited 0, `--target https://example.invalid` was rejected with exit code 1 and made no
  remote connection, and root `tsc` exited with code 0.

This run added only documentation and test assets; API, database, SDK, dependencies, and CI were not
changed. `verify:server-recovery` is an opt-in command and is not included in default
`test`, `check`, or CI.

## Not Yet Verified

- Real external OIDC publisher sign-in and JWKS lookup.
- Remote D1, multiple processes, and multiple regions.
- Duplicate removal across sleep, forced process termination, and process restart.
- A durable outbox or exactly-once delivery in the relay or client.
