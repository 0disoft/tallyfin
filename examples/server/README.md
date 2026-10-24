# Server Job Event Example

`job-analytics.ts` is an example projected from the server definition in
`api/examples/job-registry.json`. Collection targets the job's success or failure classification
and whether it was retried; job IDs, inputs, and result text are excluded. This example registers
only server events and leaves the browser allowed origins and workflows as empty arrays.

An installed service imports from `@tallyfin/server`. The relative import in this repository is
used to verify the example within the checkout. The service supplies the actual endpoint and
`getToken(signal)` for obtaining a dedicated publisher token; do not put the token in source code
or logs.

When the registered definition changes, reproject only the server definition with
`projectServerSchema` in `tools/server/schema.mjs`. The tool runs during the Node build step and
is not included in the runtime SDK. A server-only project can be registered without browser events.
An empty allowed-origins list blocks browser collection, and server publishing requires dedicated
publish permission and authentication.

Confirm the result of a send with `await client.send([event], { signal })`. A failure may already
have been stored, so preserve the eventId, occurredAt, and properties exactly when retrying. A new
event creates a separate aggregate. The SDK has no persistent queue; the service decides where
retries are stored, when they run, and how they are separated from business processing. Input
timestamps must fall within the last 24 hours.

`apps/collector/test/server-sdk.test.ts` covers Node's default fetch, a real Worker's default fetch,
signed ephemeral test tokens, publish permission, and local D1 storage. It tests lost-response retry,
duplicates, content conflicts, redirect blocking, and publisher revocation, and cleans up the local
server. It does not use a real provider, remote database, or deployment.

Related: [server SDK](../../docs/backend/server-sdk.md), [validation record](../../VALIDATION.md).
