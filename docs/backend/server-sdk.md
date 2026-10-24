# Server SDK (packages/server)

Status: The `@tallyfin/server` source, unit tests, and build were checked locally, and it has no runtime dependencies.
Local Node, Miniflare Worker, and D1 integration were also checked; remote deployment and real provider connections are
out of scope. Measurements and the full root check record are in [VALIDATION.md](../../VALIDATION.md).

This is an ESM client that uses only `fetch`, Web Crypto, and `AbortController` with no runtime dependencies. It does not depend on the DOM and is separate from the browser
[Browser SDK](./browser-sdk.md). The SDK does not store the publisher token; the host supplies it through `getToken` for each attempt.

## Configuration and Creation

`createTallyfinServer(options, host?)` creates the client. If the configuration does not follow the rules,
creation throws a `TypeError` and sends no network request.

| Option | Required | Rule |
| --- | --- | --- |
| endpoint | Yes | Only the `/v1/projects/{projectId}/server-batches` path. HTTPS, or HTTP when `allowLocalHttp` is true and the host is loopback. Userinfo, query, and fragment are rejected. |
| schema | Yes | `{ version(1~2147483647), events, funnels? }`. Include only definitions reviewed for the server source; do not include browser event definitions or workflows. Serialized size is 32 KiB or less. |
| getToken(signal) | Yes | Function that returns a dedicated publisher credential. It returns a string or Promise and is called anew for each attempt. |
| allowLocalHttp | No | Default false. |
| maxAttempts | No | 1 to 3, default 3. |
| requestTimeoutMs | No | 10 to 30000, default 5000. Applies together to token acquisition, request, and response body. |
| retryBudgetMs | No | 10 to 600000, default 30000. Includes retry waits between attempts. |

`schema.events` maps event names to property rules. Names and property keys match `[a-z][a-z0-9_]{0,47}`, with
up to 4 properties per event and 50 events. Rules are `['boolean', required]`,
`['enum', required, values]` (up to 32 allowed values, no duplicates), or `['integer', required, low, high]`
(±1000000). Each property has at most 32 choices and each event at most 256 combinations. Property values must be booleans, strings, or
integers.

`schema.funnels` is optional and has the shape `{ [id]: { steps: (string | null)[], dimensions: string[] } }`.
`steps` has 2 to 10 entries; a string is a registered server event name, and null marks only the position of a browser step.
The server projection tool adds only funnels with server participation; browser event names, property rules, labels, and purposes are not included in the SDK. If there is no such
funnel, omit `funnels` to retain the existing definition shape.

Funnel dimension enum values are compared as unordered sets, as in the Core. Using
`pdf, image` and `image, pdf` on different steps is accepted as the same rule. Only the internal JSON snapshot is
sorted, so the original schema is unchanged. Duplicates, different value sets, requiredness mismatches, and type mismatches are rejected.

`host` is optional; `now`, `monotonicNow`, `uuid`, `fetch`, and `wait` must all be functions.
The defaults are `Date.now`, `performance.now`, `crypto.randomUUID`, and `globalThis.fetch`.
The optional `timer(callback, milliseconds)` returns a cancellation function. When provided, it is used for all credential, request,
response-body, and retry-wait time limits. Pairing it with a virtual scheduler such as `monotonicNow` and `wait` allows unit testing without
real-time waits. Omitting it retains the existing `setTimeout` and `clearTimeout` behavior.

### Connection Skeleton

```ts
import { createTallyfinServer } from '@tallyfin/server';
import type { ServerSchema } from '@tallyfin/server';

const schema: ServerSchema = {
  version: 1,
  events: {
    purchase_completed: {
      plan: ['enum', true, ['free', 'pro']],
      amount_bucket: ['integer', false, 0, 20],
    },
  },
};

const client = createTallyfinServer({
  endpoint: 'https://<collector-host>/v1/projects/<projectId>/server-batches',
  schema,
  // The host supplies its real token-acquisition procedure. This SDK does not store tokens.
  getToken: signal => tokenProvider(signal),
  maxAttempts: 3,
});
```

`tokenProvider` wraps the credential issuance procedure the host already uses, and the SDK does not know its contents.
The host defines the real issuer, path, and values, and no credentials are included in documentation or code.

## Creating Events

`createEvent(name, properties?, metadata?)` creates a frozen `ServerEvent`.

- `eventId` uses the UUID v4 format, and `occurredAt` is a UTC ISO string with milliseconds. Of `metadata`, only
  `eventId`, `occurredAt`, and `funnel` are accepted so stored values can be supplied. Other keys are rejected.
- `occurredAt` is allowed only from 24 hours in the past through 5 minutes in the future relative to now. `properties` accept only registered rules;
  a missing required property or a type, enum, or range mismatch is rejected.
- Invalid input raises `ServerInputError` (code `invalid_event`).
- The returned object copies the input, freezes properties and the optional funnel link, and sorts property keys.
  If `eventId`, `occurredAt`, properties, and `funnel` are stored, the same event can be restored and resent after a process restart.

## Linking Workflow Funnels

`ServerEvent` supports an optional `funnel: FunnelLink`. The link accepts only
`{ funnelId, runId, startedAt }`. It checks the registered server step, UUIDv4, and real UTC time; each step must occur within 24 hours after the start, and the first step must use
the start time. Invalid input to `createEvent` or `createFunnelRun` raises `ServerInputError`.

`createFunnelRun(id)` starts only funnels whose first step is server. It returns a frozen link with a new UUID and the current time,
and omitting `occurredAt` on the first-step `createEvent` uses the link's `startedAt`.
The names and properties below must be registered in the definition published by the host.

```ts
const run = client.createFunnelRun('processing');
const started = client.createEvent('processing_started', { kind: 'pdf' }, { funnel: run });
await client.send([started]);
// After confirming the real work succeeded, send completion through the same link.
const completed = client.createEvent('processing_completed', { kind: 'pdf' }, { funnel: run });
await client.send([completed]);
```

If the first step is browser, do not create a new run on the server; instead, accept the link from the work context verified by the actual business request.
The server code that observed real completion publishes it with
`createEvent(name, properties, { funnel: link })`. The runId is not an authentication method or
visitor ID and uses the existing publisher authentication and authorization checks. Funnel transmission in the browser SDK,
administrator SDK code generation, and the funnel read API and screen have been implemented and verified locally. Connecting this work context
to a real service's business requests is handled by each service integration.

## Sending

`send(events, { signal? })` returns a `DeliveryResult`. It sends one atomic batch of 1 to 20 events with a UTF-8 body
of 16 KiB or less. It creates no implicit queue, timer, fire-and-forget task, or lifecycle
listener; it creates and clears a timer only while a request is waiting.

- It validates events, properties, and funnel links again and builds the body from the copied and frozen snapshot before the first attempt. Retries reuse the same body, while
  `getToken` obtains a new token for each attempt.
- Every array position must directly contain an event. Holes, deleted entries, inherited entries, `undefined`, and `null` are rejected as `rejected`/`invalid_event` with
  `attempts: 0`, without token lookup, HTTP request, or retry. The same client can send a valid batch afterward.
- Validation, credential, and transport failures are returned as results rather than thrown. A `ServerPlatform` supplied by the host must
  follow the contract below, and programmer errors that violate it may be thrown. `delivered` has
  `{accepted, duplicates, attempts}`; all other results have `{reason, httpStatus, retryable, attempts}`.
  `reason` is one of `invalid_batch`, `invalid_event`, `authentication_unavailable`,
  `transport_unavailable`, `invalid_response`, `http_error`, `retry_deferred`, or `aborted`.
- `attempts` is the number of HTTP requests actually sent.

Retry rules:

- Retried: 408, 429, 5xx, network or timeout failures, and a 200 whose receipt violates the rules
  (`invalid_response`).
- Not retried: A `getToken` failure or invalid token format ends that attempt immediately with
  `authentication_unavailable`, and the SDK does not call it again automatically. Other 4xx responses such as 401, 403, 409, and 422
  produce `rejected`/`http_error`.
- Waiting uses `Retry-After` (seconds or HTTP-date, minimum 1 second) and otherwise uses exponential backoff. For HTTP-date,
  it accepts only the 29-character GMT standard form such as `Sun, 01 Nov 2026 10:00:00 GMT`; values
  `Date.parse` would auto-correct, such as an invalid date, 24:00, or weekday mismatch, and ISO forms are not accepted. A malformed header falls back to exponential
  backoff. With the default `maxAttempts` of 3, waits between attempts are 1 s and 2 s.
- If the wait or next attempt would exceed `retryBudgetMs`, it defers with `unavailable`/`retry_deferred`
  and reports `retryable: true`.

A receipt (200) has `Content-Type: application/json` (optional charset), a body of 1 KiB or less, and exactly
`accepted` and `duplicates` as integers whose sum equals the batch size. Otherwise it reports
`invalid_response` and retries.

Cancellation covers token acquisition, the request, response reading, and retry waits. Cancellation in any of these stages returns
`aborted`/`aborted` with `retryable: false`.
The original object passed by the caller to `abort(reason)` is also forwarded unchanged to dependency signals during token acquisition, transmission,
body reads, and waits. The public DeliveryResult does not include the cancellation reason object.

Token acquisition is a host function, so synchronous work occupies the event loop. Before sending a request, the SDK therefore checks the attempt deadline
(`min(overall retry budget, attempt start + requestTimeoutMs)`) once more with `host.monotonicNow()` and, if it has already passed, ends that attempt without
sending an HTTP request. This attempt does not increase the HTTP request count and returns
`unavailable`/`authentication_unavailable` with `retryable: true`.
The signal passed to the attempt is cleaned up and cancelled. It cannot interrupt the synchronous function itself, but the caller can invoke a new `send` with the same events
to retry.

The same monotonic deadline is checked immediately after response headers arrive and after reading a valid receipt body.
Even if synchronous transmission or body processing delays a timer, a receipt after the deadline is not accepted as success. An attempt
that already sent the request is reported as `unavailable`/`transport_unavailable`, and the original batch is retransmitted only within the remaining budget and
attempt count. If headers are late, request body cleanup too.
Because the server may have stored the batch, do not create new events; preserve the identifiers and body of the existing events.

A response that arrives after a timeout or caller cancellation has its body cleanup requested and is discarded. A response from an earlier attempt
does not change the HTTP status or receipt of the current attempt. Bodies of rejection responses and invalid receipts and the reader for an
aborted response are cleaned up, and a cleanup Promise that fails or stalls does not change result determination or retry
rules. Rejections such as 401, 403, and 422 end immediately, and an invalid receipt remains
`invalid_response`. If a host injects a transport that ignores cancellation, the SDK cannot guarantee that transport will stop.

## Failures and Retransmission

Even a `rejected`, `unavailable`, or `aborted` result may have been stored by the server. `send` reports
success only after receiving a receipt, so a failure should be retried with the preserved `eventId`, `occurredAt`, and body unchanged.
The server counts duplicate instances of the same event as `duplicates`, but the SDK does not guarantee exactly-once delivery.

- The SDK has no durable queue, outbox, or retry scheduler. The host manages storage and retry timing.
- The host is responsible for choosing the real `getToken` issuer and issuing credentials. Do not put an M2M client secret
  in a browser or public bundle.
- A registry with only server definitions and the server-source read API and screen have been implemented and verified locally.
- For manual retry after failure, pass the stored `metadata` (`eventId`, `occurredAt`, optional `funnel`) and
  properties unchanged to send the same event.
- Real provider connections, production deployment, and remote D1 application are out of scope.

The retransmission experiment over local Miniflare loopback is in [Server SDK Recovery Check](../../tools/runtime/SERVER-RECOVERY.md).
`npm run verify:server-recovery` checked that the same body sent through the SDK's default `fetch` was retried and that the collector
removed duplicates (before commit accepted 2 and dup 0; after commit accepted 0 and dup 2), plus a `403` after publisher revocation,
using exit code 0 and `verified: true`. Remote D1, real
OIDC, and process restart are outside this experiment. The final check queries D1 directly for event-level
`SUM(count)` of 2 in `event_daily_counts`, 2 rows in `funnel_runs`, and the 4-step `step_times_json` for both runs.

## Security

Requests use the `Authorization: Bearer` header and `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
`redirect: 'manual'`, and `cache: 'no-store'`. They use no cookies, referrer, redirects, or cache, and
tokens, raw input, and raw errors are not included in results or logs.

Redirect responses are not followed and are returned as `unavailable`/`invalid_response`. They are
not retried automatically. Integration tests check that the default fetch in Node and Workers does not send tokens to another address.

The [work service example](../../examples/server/README.md) projects only server definitions from a reviewed registration schema.
The projection tool reads the core only at build time and does not include it in the SDK bundle.

Related: [Server Publishing Events](./server-events.md), [Event and Aggregation Contract](./event-contract.md),
and [Verification](../../VALIDATION.md).

## Retry Rule Verification — 2026-10-12

The HTTP-date validation in `retryDelay` (`packages/server/src/index.ts`) and the new regression test
`packages/server/test/retry-after.test.ts` were checked locally. Five invalid headers—a wrong weekday, nonexistent dates (November
31 and February 30), `24:00`, and an ISO form—were sent with 429 and 503 to both the source and minified SDK to check that
`Retry-After` is ignored, 1 s and 2 s exponential backoff is used, and the retransmitted body is unchanged. Before the fix,
2 source and minified regressions failed; after the fix, `npm run test:server` passed 31/31. Native
`fetch` received a 503 from a local HTTP server on a temporary port, the same body was sent again, and duplicate receipts were
checked. `npm run build:server` also passed (server SDK 8957 bytes, gzip 3678, zero runtime dependencies, declarations from `tsc`).
The scope is unit tests and local HTTP experiments; real production OIDC and remote D1 checks were not run.
There are no public API, database, CI, or dependency changes, and nothing was pushed or deployed.
