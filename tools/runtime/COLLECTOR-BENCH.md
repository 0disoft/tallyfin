# Local collector workload

Run `npm run bench:collector` explicitly. The command is not part of CI or the default
test/check workload. It accepts no options except `--help`: no URLs, target configuration,
credentials or existing database path. Each run creates a new ignored
`.tmp/collector-bench/run-*/state` database and loopback listener, then disposes the runtime
on success/failure. The CLI has a two-minute cancellation budget and each HTTP request
has a 15-second timeout. Artifacts remain for inspection.

The production collector runtime is bundled with a synthetic in-memory JWKS provider and
a fixed Worker clock. Ephemeral signing keys/tokens exist only in memory; the run contacts
no external identity provider. This covers actual JWT verification and project grants,
not an actual provider login, token refresh or network/JWKS outage. The host monotonic
clock measures HTTP/body completion. Freezing Worker time keeps all admission requests
in one minute and all events in one cohort without changing production code.

## Workload and correctness gates

| Stage | Requests | Maximum in flight | Gate |
| --- | ---: | ---: | --- |
| Workflow writes and authenticated summaries | 18 per stage | 1, 4, 8, 16 | Each stage stores 240 new events in 12 full batches; 6 reads share the same DB. |
| Concurrent identical replay | 16 | 16 | Same 20-event body: accepted 20, duplicates 300, no conflict. |
| Mixed browser/server funnels and summaries | 102 | 8 | 24 four-step runs, last milestone submitted first; 96 writes and 6 server summaries. |
| Shared browser/server minute quota | 24 | 8 | Limit 12: exactly 12 success and 12 HTTP 429 with Retry-After. |
| Other projects after quota | 2 | 2 | Both other projects still accept a new event. |

Warmup and final correctness reads are outside timing summaries. There are 216 measured
HTTP requests. No client retries hide failures. Any unexpected status, receipt mismatch,
invalid read count or final DB/API mismatch fails the command. The worker emits normal
quota-denial diagnostics; those 12 rejections are expected. The final database contains
1090 receipts, 480 successful workflow attempts, and 24 completed four-step funnels.
The quota request counter is 24 (includes denials), the minute-limit rejection counter is
12, and only 12 quota-project events were stored. Project/source summaries must agree
with independent DB counts. Pool failure stops new jobs and drains in-flight work before
disposing the runtime.

## Reports and interpretation

`report.json` includes host/runtime versions, statuses, accepted/duplicate counts,
per-stage HTTP requests/second, nearest-rank p50/p95/max and raw per-request observations.
It never includes event bodies, tokens or identity values. `failure.json` records the last
phase, completed stage summaries and received error-response evidence: status, request
kind, start time, elapsed time, allowlisted error code, valid request UUID and bounded
Retry-After seconds. Malformed JSON retains status/timing only. Evidence excludes
exception messages, response bodies and arbitrary headers. A failed run is not
performance evidence of success.

This is a short, bounded local experiment. The database grows between concurrency stages,
and one stage follows another; stages are not randomized or equal-data comparisons.
Workflow writes have 12 samples and summary reads 6, so their p95 is the observed maximum.
Local HTTP timings include host scheduling, emulator, crypto and DB work and cannot be
attributed entirely to D1. A single-process local SQLite/D1 emulator is not remote D1
capacity or an operational SLO. Sustained load, multiple workers, large retained datasets,
remote limits/cost, outage recovery and scheduled cleanup under load need separate runs.
