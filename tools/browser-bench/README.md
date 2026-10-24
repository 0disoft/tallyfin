# Browser SDK Local Measurement

Alternate between `disabled`, which loads the same addition screen without the SDK, and
`enabled`, which connects the SDK and example schema. Measure initial execution and synchronous
call cost, and verify that values aggregated in the real local collector and D1 match expectations.
Production service performance measurement is separate.

## Installation and Execution

Use Node 24 or later from the repository root. Playwright is a development dependency (`^1`)
installed only in this folder; it is not included in the SDK, collector, or default CI checks.

```sh
npm ci --ignore-scripts
npm ci --prefix tools/browser-bench --ignore-scripts
npm run bench:browser -- --channel chrome --samples 5
```

Select an installed Edge with `--channel msedge`. To use Chromium, install the dedicated browser
with the command below and run without a channel option. The benchmark does not install a browser
automatically during a run, and it does not use an installed personal browser profile.

```sh
node tools/browser-bench/node_modules/playwright/cli.js install chromium
npm run bench:browser
```

`--samples` is the repetition count for the `disabled` and `enabled` screens. The default is 5,
and the allowed range is 2..20. The `recovery` and `outage` screens each run 1 time. A normal screen
performs 11 normal calculations and 1 required-input error. Each active screen must store 1 view,
11 starts, 11 successes, and 1 error, for 24 events in total. Input numbers are not sent.

## Isolation and Failure Checks

Each run uses a new temporary local D1 database and a `127.0.0.1` server on a random port. Only the
origin in the existing registration example is changed to the measurement server address and
registered in that temporary database. Production databases and credentials are not used. Browser
page requests are allowed only from the measurement server origin. Aggregates are read through
trusted local database access; there is no HTTP path that bypasses administrator authentication.

Verify that the disabled screen makes 0 SDK downloads and 0 collection requests. Verify the active
screen's 200 responses and database aggregates. The `recovery` screen blocks the first batch with a
502 before the collector, then stores the next attempt in D1 and cuts only the HTTP response.
Verify that the retry sends the same body, that the collector counts the replay as duplicates without
double aggregation, and that a calculation made while waiting for the retry is not lost. Then stop
the actual collector and run the `outage` screen. Observe that input, calculation, and error
recovery continue to work and that the proxy returns 503. Also verify that retries stop after SDK
`destroy()`. On exit, failure, or Ctrl+C, close the owned server and browser and delete the
temporary database. Preserve the result JSON.

## Results and Interpretation

Raw records and the summary are stored in `.tmp/browser-bench/<timestamp>.json`. They include the
run environment, browser version, per-iteration measurements, database aggregates, request counts,
body bytes, and status codes. Payloads and credentials are not recorded. The tool also checks
whether requests have an Origin and whether cookies, authentication, and Referer are absent. The
`recovery` run records the transport trace, a SHA-256 match for the first three bodies, and whether
a replay after a lost response is treated as duplicates. These SHA-256 and accepted/duplicates values
are synthetic measurements, not production logging.

- `sdkImportMs`: dynamic import time, including download, module compilation and linking, and
  evaluation.
- `sdkInitMs`, `sdkCallsMs`, and `handlersMs`: client initialization, synchronous SDK calls, and
  input and calculation handler execution time.
- `handlerToSecondFrameMs`: time from handler start to the second rAF callback. This is not the
  actual display time or INP.
- FCP, Event Timing at the 16ms threshold, and long tasks are collected only in supported browsers.
  Event Timing and long-task data are present in the raw records.
- SDK resource transfer, encoded, and decoded bytes, plus a separately calculated gzip size. The
  measurement server serves SDK files uncompressed.

The run uses a new context, no-store, headless 1280 × 800, and no CPU or network throttling. The same
browser process is reused. FCP can fire before SDK import, and initial browser-run variance is mixed
into the results. Call and handler p95 values combine calls across screens and are not independent
user samples. Do not use small-sample results to establish production latency or a Core Web Vitals
score. A 0ms measurement can be below the browser clock's resolution. Empty Event Timing data can
mean either below-threshold timing or lack of support.

Execution results are recorded in the [performance budget](../../docs/engineering/03-performance-budget.md).
The definitions follow [Resource Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)
and [Event Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming), and
browser selection follows the [Playwright guide](https://playwright.dev/docs/browsers).

If the browser executable cannot be found, select an installed channel or run the Chromium
installation above. Installation errors, storage mismatches, and calculation errors are not treated
as success and cause a non-zero exit. Run this tool locally when needed; it is not connected to the
default `npm run check`.

`npm run verify:admin-analysis-access` is a separate administrator analytics permission regression
check. It uses a synthetic signed sign-in and a new local D1 database, revokes read permission, and
checks whether the existing summary and CSV become locked. It also checks another project's real CSV
content, explicit recovery, discarding a late 403 after a project switch, and disconnecting. It
closes the server and browser and leaves raw results and the local database in the ignored
`.tmp/admin-analysis-access-*` path. It uses no real provider, remote database, or deployment and is
not part of default CI.
