# HTTP API Policy

Status: The [OpenAPI](../../api/openapi.yaml) v0.1 contract and the collector and administrator servers have been implemented and verified locally. Production deployment does not exist yet.

Public ingestion POST accepts only JSON batches of 20 events or fewer and 16 KiB or less, or text/plain containing JSON.
Origin is compared exactly against the allowlist, and CORS credentials are not allowed.
OPTIONS allows only POST and Content-Type. Ingestion neither requires administrator credentials nor
elevates public ingestion authorization with a bearer token.

Server ingestion uses a separate `POST /v1/projects/{projectId}/server-batches` endpoint, which checks the publisher bearer token and
project publishing authorization before admission. It accepts JSON only, allows 20 events or fewer and 16 KiB or less, supports POST only, and
provides no query parameters, CORS, or preflight. Server ingestion is disabled until publisher authentication is configured.
See the [Server Event Contract](./server-events.md).

Duplicates are determined by the `eventId` in the body. The same ID and content returns 200 duplicates; a content conflict returns
409 and the whole batch is rejected. Unknown fields, events, properties, or versions and invalid
times or values are not silently skipped. A transient failure returns 503.

Administrator GET requests check the verified principal's project grant every time. Lists contain at most 100 projects,
date queries cover at most 31 days within the retention window, and version and source are fixed. Responses are no-store, and
errors are not replaced with zeroes. See the [detailed contract](./event-contract.md).

Administrator project creation POST checks separate creation authorization before reading a closed JSON document of 16 KiB or less.
The initial owner is the authenticated creator. If the project ID, creator, and initial request hash match, the existing creation
result is returned with 200, and the current settings are not rolled back. Settings PATCH requires the owner and the previous
settings hash; schema PUT requires the owner, the latest version, and confirmation of the privacy review.
Every administrator response is no-store, and CORS authorization and cookie issuance are not provided.
Follow the [Administrator API](./administrator.md).
