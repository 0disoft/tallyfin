# Error Responses

Status: Implemented and verified locally; production deployment not verified.

Errors use ErrorResponse from the [OpenAPI](../../api/openapi.yaml) contract. `code` is a fixed enum,
`message` is a short safe explanation, and `requestId` is a temporary random UUIDv4 for that request.
Raw values, property values, tokens, URLs, IP addresses, account information, and stack traces are not included in messages.
400/403/404/409/413/415/422/429/503 are distinguished according to the ingestion situation.
Administrator reads distinguish 401 from 403, and a storage failure is not converted into empty statistics.
No batch error emits a partial accepted response.
See the [error example](../../api/examples/error-response.json) and the [full contract](./event-contract.md).
