# Performance Budget

This document states Tallyfin's performance targets. The core, storage adapter, minimal collector, and browser SDK have been verified locally. It includes real-browser measurements of a synthetic calculator screen and load experiments with a synthetic D1 collector; real service and production benchmarks remain.

## Targets

- Service integration overviews are limited to at most 5 projects, 1 HTTP request, at most 17 D1 batches, and at most 42 SQL statements. Current and previous events and workflows are each read together, and returned rows are capped per project at 101 events and 15 workflows. Rejection records sum pages of at most 4,096 rows one service at a time and retain no raw text. Raw JSON is limited to 8MiB per result; JavaScript object, database runtime, and string representation costs are separate. This is not a measured maximum heap. The call count increases compared with the existing 17 SQL statements, but the 7-day raw text of every service is not gathered in one batch. When no schema is active, analytics SQL is skipped and only ingestion and rejection diagnostics are read. Unauthorized IDs do not start a rejection page. Production latency and D1 rows-read cost have not been measured, and a reduction in request count is not interpreted as a percentage speedup. Completion-rate samples, in-progress state, and actual query periods are calculated from existing results without adding SQL. Date-change confirmation in an open table uses only the local clock and adds no API polling.

- The shared browser SDK alone targets at most 3KiB gzip, and the incremental total of one service's integration code and required configuration targets at most 3.25KiB gzip. This excludes a whole host app and the combined settings of every project. Per-project settings are included in transfer size and initial runtime cost.
- There is no synchronous collection I/O, and rendering or calculations do not wait for delivery to finish.
- Do not claim target figures before measuring them.

## Buffers and delivery

- Gather events in a size-limited in-memory buffer.
- Send batches periodically and attempt to send any remaining batch when the tab becomes hidden.
- The SDK does not use native sendBeacon. sendBeacon forces credentials to be included, so keepalive fetch preserves omit and no-referrer.
- Delivery is not guaranteed regardless of the transport.
- Contract limits: 40-event memory buffer, 20 events and 16KiB per batch, delivery every 5 seconds, at most 2 retries over 10 minutes, and 48-hour receipts. This is implemented locally in the browser SDK, and the 2026-10-08 measurement was 2667 bytes gzip for the SDK and 2949 bytes gzip for the SDK plus Sembom (budget 3072 bytes). Initial runtime and delivery cost were measured below on the synthetic screen; real service cost has not been measured.
- Bounded retries, batch idempotency, atomic aggregation, and input and rate limits are required. Worker memory counters are not used as persistent aggregates.

## Measurement Methods

- Compare the baseline (disabled) and enabled states under the same conditions.
- Look at interaction latency, SDK execution time, and transfer size together.
- Check services other than Sembom too. Do not send every project's event definitions to the browser at once.
- Write and query latency under concurrent delivery was measured once on a local synthetic D1 (2026-10-11 below). Collection and storage cost by project count and registered-property combination scale has not been measured; the latency budget for server integration will be set in follow-up implementation.
- Production latency and transfer budgets are UNDECIDED. The figures below are observations from local synthetic screens.

## 2026-10-08 Local Chrome Measurement

Command: `npm run bench:browser -- --channel chrome --samples 5`.
Windows, Node 24.18.0, Chrome 154.0.8037.98, Playwright 1.64.0, headless 1280×800,
no CPU or network throttling. Disabled and enabled order was alternated, and 5 new
contexts were run for each mode. Assets used no-store, and the browser process was
reused. The raw record is the local ignored file `.tmp/browser-bench/1791469967935.json`.

| Measurement | No SDK | SDK enabled |
| --- | ---: | ---: |
| Dynamic import median | Not applicable | 48.9ms |
| Client initialization median | Not applicable | 2.0ms |
| Synchronous SDK call p95 | Not applicable | 0.4ms |
| Input/calculation handler p95 | 0.1ms | 0.3ms |
| p95 to second rAF | 32.0ms | 31.2ms |
| Collection requests per screen | 0 | 2 |
| Total upload body per screen | 0 bytes | 6430 bytes |

Import time includes network, compile and connect, and evaluation. Frame figures are not
INP, and the 31.2ms versus 32.0ms difference is not interpreted as a speed improvement.
FCP median was 76ms disabled and 68ms enabled, but the first disabled screen had a 712ms
outlier and FCP can occur before the SDK import, so it is not used as evidence of SDK
impact. The long-task records in this run were empty. The sample is small and limited by
browser clock resolution and the automation environment.

The SDK, example schema, and local integration code used for measurement were 6373 bytes,
or 2879 bytes gzip. This bundle differs from the actual Sembom adapter, and the existing
SDK+Sembom budget check remained at 2949 bytes. The measurement server served the SDK
without compression, so the Resource Timing transfer size was 6673 bytes. Do not use
2879 bytes gzip as the actual download or upload size.

Five active screens showed 120 events, 55 starts, and 55 successes in D1.
On an additional screen where the collector was actually stopped, 11 calculations and
error recovery still worked. Four 503 responses were observed, and no further retries
occurred after SDK destroy. Functional checks and instructions for rerunning the
measurement are in the [measurement tool guide](../../tools/browser-bench/README.md).

## 2026-10-11 Administrator Chart Lazy Loading

The administrator prototype overview's daily trend chart was split into a lazy-loaded
chunk, and first delivery was measured. The baseline is commit `53aa645`. Figures are
decimal KB and gzip from the build.

| Bundle | Baseline | Lazy loaded |
| --- | ---: | ---: |
| Initial JS | 800.26kB/gzip 228.43kB | 446.61kB/gzip 125.83kB |
| Chart chunk | None (included in initial JS) | 353.93kB/gzip 102.84kB |
| Overview total JS gzip | 228.43kB | 228.67kB |

Initial JS fell by about 44.9%, but the overview includes the chart on its default screen,
so the chunk arrives with it, the total is nearly unchanged, and requests increase from
1 to 2. Initial entry JS is smaller on every screen, and screens without charts skip the
chart download entirely. Do not generalize this to lower total bytes or load time on every
screen. This split removed the Vite warning for chunks over 500kB.

On a local `vite preview` (production build), with the same tab and caching off, the
baseline was measured 3 times, followed by 3 consecutive lazy-load measurements. FCP
median changed from 376ms to 296ms, DCL median from 266.3ms to 175.6ms, and overview main
fetch completion from 302/213.4/139.1ms to 77.3/93.3/88.4ms, with chart chunk fetch
completion at 378/541.2/433ms. There were 3 samples in a sequential run, warmup was mixed
in, and no improvement is guaranteed. Do not interchange compression values from the local
preview server with gzip figures from the Vite build.

Measurement conditions, raw figures, and the chart-blocking, 320px, and date-change checks
are in the [validation record](../../VALIDATION.md).

## 2026-10-11 Administrator Font Loading Cleanup

The administrator prototype fonts were changed from 9 static CSS files by weight to 2
variable-font CSS files
(`@fontsource-variable/inter/wght.css`, `@fontsource-variable/noto-sans-kr/wght.css`),
and first-screen delivery was measured again. The baseline is the build from commit `b12753d`.

| Item | Baseline | Variable fonts |
| --- | ---: | ---: |
| Built CSS | 380.42kB/gzip 119.38kB | 264.85kB/gzip 35.91kB |
| First-screen font requests | 28/324224 bytes | 9/178064 bytes |
| CSS plus font transfer | 438007 bytes | 211796 bytes |

CSS gzip fell by about 70%, font bodies by 45.1%, and CSS plus fonts by 51.6%. One variable
woff2 file is shared across unicode-range subsets, so a separate file is not downloaded for
each weight. Initial JS stayed at 446.61kB/gzip 125.83kB, and module and chart chunk sizes
did not change.

On local `vite preview` (production build, port 5180), with caching disabled, Resource
Timing was compared once for the baseline and once for variable fonts after
`document.fonts.ready`. The encoded CSS served by preview changed from 113783 to 33732 bytes.
Headers were excluded, and preview-server compression is not interchanged with Vite build
gzip. The overview title, metrics, and table geometry matched before and after; exhaustive
glyph validation, production CWV, and older browsers were not measured. Do not generalize
these figures to other languages, other screens, or production.

Measurement conditions, raw figures, and subset-loading and WOFF2-blocking checks are in the
[validation record](../../VALIDATION.md).

## 2026-10-11 Local Collector Load Experiment

Command: `npm run bench:collector` (opt-in and not connected to default test, check, or CI).
A fresh synthetic D1, loopback HTTP, and actual JWT verification measured 216 requests; 204
returned 200 and 12 returned the designed quota 429. The Worker clock was fixed, and HTTP
time is host monotonic-clock measurement. JWKS was synthetic in memory, and no actual
provider was connected.

| Concurrency | Workflow write p95 | Authenticated query p95 |
| ---: | ---: | ---: |
| 1 | 47.13ms | 9.35ms |
| 4 | 111.39ms | 109.87ms |
| 8 | 190.01ms | 189.35ms |
| 16 | 322.82ms | 321.15ms |

Each stage processed 12 batches of 240 new events and 6 queries against the same DB. The
stage that replayed the same 20 events at concurrency 16 ended with accepted 20 and
duplicates 300; the shared per-minute limit of 12 used by browser and server ended with 12
successes and 12 429s, and 2 events for another project were accepted normally afterward.
The final DB had 1090 receipts, 480 workflow start and success records, and 24 completed
4-step funnel runs.

This was a small sequential sweep, the DB grew at each stage, and each stage did not have
the same data conditions; the p95 is the maximum of 12 write and 6 query samples. Loopback
HTTP time mixes host scheduling, the emulator, cryptography, and DB work, so the D1 share
cannot be isolated. Do not use this result to judge sustained load, multiple Workers, large
retained datasets, remote limits or cost, failure recovery, load during cleanup, or
production SLOs. Measurement conditions and raw figures are in the
[local collector load guide](../../tools/runtime/COLLECTOR-BENCH.md) and the
[validation record](../../VALIDATION.md).

## 2026-10-11 Concurrent Retained Data and Automatic Cleanup Experiment

`npm run bench:retained` inserted 67,860 rows into 6 projects and four data tables in a new
local D1, then served 8 HTTP requests per second for 120 seconds on the actual Worker clock.
SQL synthetic-data generation and authentication warmup were excluded from measurement. All
480 writes and all 480 authenticated 30-day summaries succeeded, and 24 actual scheduled
cleanups also succeeded. The concurrent work cap including cleanup is 16, and this experiment
did not explore maximum throughput.

| Observation | Samples | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| HTTP write | 480 | 28.98ms | 48.95ms | 169.98ms |
| HTTP query | 480 | 7.96ms | 10.96ms | 53.47ms |
| Scheduled cleanup | 24 | 54.12ms | 123.60ms | 158.71ms |
| Task publication latency | 984 | 7.62ms | 13.96ms | 30.62ms |

It confirmed 8,800 new events, 800 duplicates, and 4,400 new workflows. It deleted 16,920
expired rows, and every retained aggregate matched the initial rows plus accepted changes.
All 24 cleanups overlapped with HTTP work, and the cursor alternated between 5 projects and
1 project. The actual load window was 120,011.575ms. Cleanup was invoked every 5 seconds,
faster than the production 1 minute, so this interval is not read as a production policy.

This is one observation on Node 24.18.0, Windows x64, Ryzen 5 7430U, and Miniflare
4.20260730.0. JWKS was synthetic in memory, and remote D1, actual authentication,
long-running or multiple Workers, large data outside the four tables, and failure scenarios
were not verified. Do not use this as production throughput or an SLO, or as a speed
comparison with the earlier short concurrency experiment. Rerun conditions are in the
[retained data load guide](../../tools/runtime/RETAINED-BENCH.md).

On 2026-10-11, `bench:cluster` ran 120 seconds of real time at 7.5 HTTP requests per second
(900 requests) and 24 cleanups with an initial 148,260 rows and 3 collector Workers on a new
shared local D1. Even when the same batch arrived at the 3 Workers concurrently, accepted
3,600, duplicates 7,200, 600 workflows, and 600 4-step funnel runs matched expectations.
Observed maximum HTTP concurrency was 15, and 12 calls overlapped cleanup and HTTP. p95 was
360.163ms for workflows, 366.852/366.711ms for browser/server funnel writes, and
85.994/92.917ms for summary/funnel queries. These are separate Workers within one workerd
and are not evidence of production multi-region, long-running, or maximum-capacity behavior.
Because load type, concurrency, and initial data differ, do not compare speed with the
earlier single-Worker experiment. Rerun conditions and full results are in the
[concurrent load guide](../../tools/runtime/CLUSTER-BENCH.md) and the
[validation record](../../VALIDATION.md).

On 2026-10-11, `bench:cluster -- --soak` used the same 3-Worker shared local D1 setup,
inserted an initial 148,260 rows, and ran 4,500 HTTP requests (7.5 per second) and 120
cleanups over 600 seconds. accepted 18,000, duplicates 36,000, and 3,000 4-step funnel runs
matched expectations; maximum HTTP concurrency was 15, cleanup/HTTP overlap was 60, and
administrator and publisher tokens were issued 3 times each. p95 was 310.971ms for
workflows, 311.104/312.008ms for browser/server funnel writes, 56.607/57.264ms for
summary/funnel queries, and 303.135ms for cleanup, while task publication latency p95 was
14.434ms. Expired-row cleanup, cleanup revision 120, and a total step reach of 3,000 across
the 3 Workers were confirmed. Do not compare speed with the 120-second run that used a
different sample window. These are separate Workers within one workerd and are not evidence
of remote, multi-region, long-running, maximum-capacity, or production SLO behavior. Rerun
conditions are in the [concurrent load guide](../../tools/runtime/CLUSTER-BENCH.md) and the
[validation record](../../VALIDATION.md).

## Failure Handling

- A collection failure does not affect the connected service's UI or business processing.
- The collector rejects projects in the paused state. The SDK implements disabling with `enabled: false` and disconnecting with `destroy()`.

## Delivery Diagnostics and Size Budget — 2026-10-23

The browser SDK uses an optional synchronous onDelivery(state, events) callback to distinguish HTTP acceptance, retry,
final failure, deadline expiry, queue overflow, destroy discard, and acceptance into the host beacon queue. It does not
pass event contents or IDs. Callback exceptions and re-entry do not change delivery state.
The SDK-only budget remains 3KiB gzip. The budget for representative integration code and required settings including
delivery diagnostic code is adjusted to 3.25KiB (3,328B). Because the existing reference example was already close to 3KiB,
this explicitly allows about 130B of additional code cost instead of removing diagnostics or reducing verification.
This paragraph supersedes the earlier 3KiB full-integration target and past measurements.
