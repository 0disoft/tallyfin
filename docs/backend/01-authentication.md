# Authentication Boundary

Status: The verifier port, the administrator 401 closed path, and the OIDC JWT signature verification adapter have been implemented and verified locally.
A real identity provider, browser sign-in, token issuance and refresh, and production deployment have not been connected yet.

An administrator bearer token is converted to an issuer and subject through a trusted verifier. The verifier must check the
signature, trusted issuer, audience, and validity period. Do not authenticate with a plain decode.
A deployment without a configured identity provider or verifier keeps the administrator API closed.
The host connects a verifier with `createWorker(verifyBearer)`, while the default export is created without a verifier
and closes administrator routes with 401. Tallyfin does not assume that it implements its own sign-up or token issuance system.
Host wiring and read routes are described in the
[Administrator Read Boundary](./administrator.md).

A host can connect an OIDC JWT access token verifier with `createOidcWorker(options)`.
Configuration, public-key caching, supported profiles, and limitations are covered in the [OIDC Adapter](./oidc.md).

Public browser collection does not send administrator tokens, and projectId or Origin is not authentication.
Server ingestion has a separate boundary at `POST /v1/projects/{projectId}/server-batches`: it verifies a publisher bearer token and the project's publishing grant before admission.
See the [Server Event Contract](./server-events.md).
