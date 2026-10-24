# Browser SDK (packages/browser)

Status: The `packages/browser` SDK (`cb3f2ff`) and the `examples/sembom` example and size checks (`f356d8a`) were implemented and verified locally. The example has not been installed or activated in the real Sembom repository, and the API and database contracts are unchanged. Funnel-link transmission in the optional profile `@tallyfin/browser/funnels`, which is separate from the main entry point, was also implemented and verified locally, and the administrator connection guide that generates this profile code was implemented and verified locally. Validation of names and identifiers as raw strings was committed in `15faf3d`.
Transmission semantics follow the [Event and Aggregation Contract](./event-contract.md), and the receiving boundary follows [Collector Implementation](./collector.md).

## Boundary
`createTallyfin({ endpoint, schema, allowLocalHttp?, enabled? }, host?)` returns a `BrowserClient`. The SDK has no external runtime dependencies and does not bundle the server core or D1 runtime. It does not embed service-specific event names, and the registered schema is projected and compressed from the registry at build time with `projectBrowserSchema` in `tools/browser/schema.mjs`. An optional `BrowserPlatform` (`now`, `uuid`, `timer`, `send`, optional `monotonicNow`, `beacon`, `onHidden`) attaches test or explicit adapters.

The default host uses `Date.now` for event and HTTP dates and `performance.now` for retry budgets.
A custom host that omits `monotonicNow` retains the existing `now` behavior. The clock and timer
must use the same elapsed-time basis. Because of the finite input limit, one event is under 800 ASCII
bytes, so assembling 20 at once also stays within 16 KiB.

Internally, `types.ts` holds the existing public types, `common.ts` handles property validation, native adapters, the queue, retries, hidden-page sending, and destroy, and `index.ts` handles workflow validation and the track/start entry points.
Internal enqueue was separated to receive linkage fields in a common shape, while the existing workflow `{ attempt }` format and public BrowserClient API remain unchanged. The browser funnel module is implemented as the optional `@tallyfin/browser/funnels` entry separate from the main entry and is not included in the default bundle.

## Disabled, SSR, and Invalid Configuration
In each of the following cases, it returns a no-op client without listeners: `enabled: false`; no browser environment (`document`, `fetch`, `crypto`) without a custom host; an invalid endpoint or schema; or an exception during checks. The no-op client returns `false` from `track`, `undefined` from `start`, and a `pending` value of 0.

The endpoint must use the `/v1/projects/<id>/batches` path and HTTPS and must reject userinfo, query, and fragment. Explicitly setting `allowLocalHttp: true` also allows HTTP on localhost, 127.0.0.1, and [::1]. A schema is rejected when `JSON.stringify(schema).length` exceeds 32768; this length is JavaScript string length, not UTF-8 byte count.

## Client API
- `track(name, properties?)`: Buffers only regular events. Workflow step names are rejected.
- `start(workflow, properties?)`: Creates a start event with an attemptId and startedAt and returns an `AttemptHandle`. No handle is created if the start cannot be buffered.
- `AttemptHandle.succeed/fail(properties?)`: Adds a completion only once within 24 hours. Properties must be an object; arrays, null, primitives, and functions return `false`. Omitting properties or passing an empty object uses the dimensions from start. An invalid call does not consume the handle, so it can be retried with valid properties. Changed dimension values are rejected, and `fail` returns `false` for a workflow without a failure step.
- `AttemptHandle.cancel()`: Prevents later completion events. A start event already in the buffer remains.
- `flush()`: Schedules transmission at the next opportunity. It does not make the caller wait for network completion.
- `destroy()`: Clears listeners and timers, stops in-flight I/O, and releases memory. Late responses are ignored, and calling it twice is safe.
- `pending`: The sum of buffered, in-flight, and retrying events; it is not a count of completed deliveries.

A `true` result from `track`, `succeed`, or `fail` means the in-memory buffer accepted the event. It does not mean the server stored it.

An event is snapshotted once before buffering and checked against registration rules. Unknown names or keys, free-form strings, nested objects, and arrays are dropped. Event IDs are generated with `crypto.randomUUID`; if generation fails, the event is not sent, and it does not fall back to a weaker random source.

Names and identifiers are checked for being raw strings before conversion. The event name snapshot in `common.ts`, the workflow identifier and attempt ID in `start` in `index.ts`, and event IDs in `common.ts` enqueue must pass `typeof value === 'string'`. Objects that look like strings through `toString` or `toJSON` are rejected at this stage, so no conversion or serialization occurs and unregistered content cannot be carried in a name or identifier position.

## Funnel Profile (`@tallyfin/browser/funnels`)

The main entry does not include funnel code. Only services that use funnels import `createTallyfinFunnels(options, host?)` from the optional entry `@tallyfin/browser/funnels`. `options` accepts a `FunnelSchema` (`version`, `events`, `funnels`), and `host` is the existing optional `BrowserPlatform` port for custom hosts. Buffering, retries, batch transmission, `flush`, `destroy`, and `pending` share the same in-memory transport (`createTransport`) as the main client and create no separate storage or additional endpoint.

`FunnelClient` adds `createFunnelRun` and `trackFunnel` to `track`, `flush`, `destroy`, and `pending`, and has no workflow `start` entry point. Funnel runs are separate from workflow attempts, so a run started in one entry cannot be continued in the other.

- `createFunnelRun(id)`: Creates a new run context for a registered funnel. The returned `{ funnelId, runId, startedAt }` are frozen values; it adds no events and performs no network I/O. `runId` is a new UUIDv4 every time and is not reused as a visitor identifier. It uses no storage, cookies, or `localStorage`. It returns `undefined` for an unregistered, disabled, or destroyed funnel, or a funnel whose first step is not browser. Thus a browser can create runs only for funnels that start with a browser step.
- `trackFunnel(name, properties, link, occurredAt?)`: Copies and validates `link`, then buffers the step event. `link` is immutable and contains only `funnelId`, `runId` (UUIDv4), and `startedAt` (strict UTC); once validated, it is not changed. A browser step of a funnel started on the server is also accepted through this route. For a manual retry, pass the original `occurredAt` to preserve the first logical occurrence time.
- `track(name, properties?)`: Buffers only regular events. A registered funnel step name returns `false`.

Funnel dimension values use the same finite-value registration rules on every step. If their definitions differ between steps, the server rejects the event, so the host must not change dimensions or the logical occurrence time while the link is active. Server steps remain only as `null` placeholders in the build-time projection (`projectFunnelBrowserSchema`) to preserve order, and the browser bundle does not include server definitions.

Workflow and funnel enum values are compared as unordered sets. `pdf, image` and
`image, pdf` are the same rule. The SDK sorts only its internal JSON snapshot and does not modify the original
schema supplied by the host. Different value sets, duplicate values, requiredness mismatches, and property-type mismatches continue to be rejected.

Examples are in `examples/funnels/browser.ts` and `examples/funnels/browser-schema.json`.

The administrator connection guide generates this profile exactly. When a workflow funnel is selected for a browser source,
`sdkSetup(registry, origin, 'browser', { profile: 'funnels', funnelId })` generates the
`@tallyfin/browser/funnels` factory and the funnel projection from `tools/browser/schema.mjs` (browser
step names and `null` server placeholders), with a commented usage example for the selected funnel.
The regular profile generates the existing `createTallyfin` and workflow code, while the funnel profile includes only regular events and
registered steps and removes workflow-only events from the schema. Examples contain no credentials; only funnels whose first source is browser use
`createFunnelRun`, and the rest use the delivery context verified by the host.

The build shortens only six reserved `__tfBatch` fields in the SDK-internal Batch. Public SDK and HTTP key
names remain unchanged. A local bundle of administrator-generated code with a fixed endpoint and configuration is within the 3 KiB gzip
budget. On 2026-10-12, gzip measurements were 2775 B for the default, 3047 B for Sembom, 2920 B for funnels,
3050 B for the reference example, and 3072 B for administrator-generated funnel code. Generated-code measurements use a fixed reference
registry and endpoint and do not guarantee 3 KiB for arbitrarily large user schemas.

## Buffering, Retry, and Transmission
- The in-memory buffer holds 40 events including in-flight events. A batch has 20 events and 16384 bytes; it sends asynchronously when 20 events accumulate or 5 seconds pass.
- It retries only network and timeout failures (status 0), 408, 429, and all 5xx responses, up to 2 times; it does not retry 401, 403, 409, or 422. Retry-After ([RFC 9110 `10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)) takes priority for the wait. Integer seconds are used as-is, and a standard IMF-fixdate (for example, `Thu, 08 Oct 2026 15:01:15 GMT`) becomes the remaining time relative to the browser host's current time. The minimum wait is 1 second, and a past time also means 1 second. Other formats are ignored in favor of 1-second and 2-second backoff. If the wait would be 10 minutes or more from the start of the batch, the batch is discarded without retransmission. Retries preserve the original ID, time, and body.
- Response bodies are cancelled without being stored or logged. The client does not wait for cleanup to finish and processes the received HTTP status even if cleanup fails or stalls. A delayed cleanup from a 200, 401, 403, or 422 response does not trigger a timeout retransmission.
- Native `sendBeacon` is not used because it forces credentials. Keepalive fetch uses `credentials: omit`, `cache: no-store`, `referrerPolicy: no-referrer`, `redirect: manual`, and the CORS mode default of the native fetch implementation. Redirects are not followed and the batch is discarded. A filtered redirect with status 0 goes to the non-retrying 3xx branch internally, while network exceptions and custom-host status 0 are retried as before. The ingestion address must be a final endpoint without redirects.
- The hidden callback does not resend in-flight batches and does not skip Retry-After; it immediately starts at most two keepalive batches that have not yet been sent. `BrowserPlatform.beacon` remains an optional port for explicit custom hosts and falls back to keepalive fetch when it returns `false` or throws. Beacon `true` means the browser accepted the queue, not that the server stored the event.

The client does not send raw input or results, amounts, email addresses, account, order, or file IDs, URLs, referrers, DOM data, persistent identifiers, or cookies, and it does not use `localStorage` or `sessionStorage`.

The 16384-byte batch and 16000-byte per-event limits are measured in JavaScript string length, not UTF-8 bytes. Serialized names, keys, and enum values are restricted by ASCII patterns (`namePattern` and `enumPattern`), and UUIDs, ISO times, booleans, and integers are ASCII, so the two values are currently equal. An extension that allows free-form strings or non-ASCII values within this range must restore these comparisons to UTF-8 byte measurement.

## Build and Checks
```sh
npm run test:browser
npm run build:browser
npm run check:browser-size
```

`build:browser` creates an esbuild bundle and `tsc` declarations. `check:browser-size` checks that the example schema projection matches, bundle boundaries, the 3 KiB standalone SDK gzip budget, and the 3.25 KiB representative-integration total. It also checks funnel example projection matching, funnel bundle boundaries, and the funnel SDK-plus-example budget. The same command links administrator `sdkSetup`-generated funnel code directly to the source SDK and checks its size including endpoint and schema, absence of runtime dependencies, and absence of other profiles. Current sizes follow the verification record after delivery diagnostics were added; the 2026-10-12 values above are history from before that addition. After body-cleanup and redirect improvements, the 32 browser checks, 6 administrator funnel SDK generation checks (38/38 total), root type check, `build:browser`, and `check:browser-size` passed. Duplicate array and object creation in schema validation, batch packaging, and funnel link copying was reduced, and numeric checks were consolidated into the same shared safe-integer check. After raw-string checks for names and identifiers, the 36 browser checks and 6 administrator funnel SDK generation checks (42/42 total) plus `npx --no-install tsc --noEmit`, `build:browser`, and `check:browser-size` passed; when the new four `packages/browser/test/identities.test.ts` cases were run in isolation against HEAD before the check was added, three failed. The public SDK and HTTP keys and the verification scope are unchanged. Execution records, including real-browser checks, are in [VALIDATION.md](../../VALIDATION.md).

The generated funnel code first exceeded the budget at 3099 B, then was reduced to 3072 B by sharing object checks, calculating the retry-wait minimum once, and removing the timer relay function and temporary beacon values. Input, duration, and retry checks and public keys are preserved. The 45/45 browser checks, 242/242 administrator checks, SDK build, root type check, and local Chromium onboarding and lost-response regression for generated SDK code passed. Because generated code is exactly at the limit, rerun the same measurements after tool or SDK changes.

## Remaining Verification
The measurement tool's `recovery` and `outage` screens were used to check real-browser initial execution, synchronous calls, and transmission on a synthetic screen, behavior when the collector stops, and recovery from 502 responses and lost responses. These are in the [measurement tool](../../tools/browser-bench/README.md).

Still outstanding are installation and activation in the real Sembom service, service latency and throughput, mobile and production environments, and remote deployment.
Applying the funnel example to a real service is also outstanding. Administrator SDK code generation has been implemented and verified locally for standard and funnel profiles and server configuration, and the reader/owner funnel daily read API, administrator funnel analysis screen and CSV, and funnel-specific step editor form have also been implemented and verified locally.
Connecting to real production publisher and administrator authentication is follow-up work.
Raw-string checks for names and identifiers were verified only with Node-level tests, not in a real browser or against a deployed collector.

## Delivery Diagnostics — 2026-10-23

Optional `onDelivery(state, events)` synchronously reports only fixed causes and counts.
`accepted` is the number of events for which an HTTP 2xx response was observed; it is not a count of new aggregates and may include duplicates.
`retry` is the batch event count for a scheduled retry, `failed` is a batch that ended with an HTTP rejection or exhausted retries,
`expired` is a batch whose transmission budget expired before sending, `overflow` is an event that could not enter the queue, and `destroyed` is a remaining event discarded on explicit shutdown.
`beacon_queued` means an injected host accepted the queue and does not guarantee server delivery. Invalid input or a disabled SDK keeps the existing `false` return. The callback receives no content, ID, or URL; use only short synchronous work such as incrementing an in-memory counter.
The standalone 3 KiB and representative-integration 3.25 KiB budgets follow the performance budget document.
