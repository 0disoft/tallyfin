# Administrator and Publisher JWT Verification Adapter

Status: Signature and claim verification in `packages/auth-oidc` and the `createOidcWorker` connection were implemented and
verified locally. PKCE sign-in and rotating refresh in the administrator prototype were also implemented locally. The publisher
(machine) verifier, the `exclusiveAudience` policy, and the `PUBLISHER_*` settings wiring in `runtime.ts` and `config.ts`
were implemented and verified locally. The current check scope follows VALIDATION.md.
Real identity provider connections and production deployment have not been done. The server adapter verifies JWT access tokens.

## Host Connection

`createOidcVerifier(options)` returns a verifier that fits the existing `createWorker(verifyBearer)` port.
`createOidcWorker(options)` combines the two calls. Existing custom verifiers and the default export without a verifier
remain available. The default export closes the administrator API with 401.

```ts
import { createOidcWorker } from './apps/collector/src/index.ts';
import type { OidcOptions } from '@tallyfin/auth-oidc';

// The host calls this after reading its real provider configuration. Reading configuration and deployment are host responsibilities.
export function configureAdministrator(options: OidcOptions) {
  return createOidcWorker(options);
}
```

| Setting | Behavior |
| --- | --- |
| issuer | Required. Compares `iss` exactly against the HTTPS URL of the trusted issuer. The trailing `/` is significant. |
| audience | Required. The audience value of the Tallyfin administrator API. Separate from the browser sign-in client ID. |
| jwksUri | Required. The HTTPS public-key address specified by the operator. It is never taken from a token or request. |
| algorithms | Defaults to `['RS256']`. The host explicitly chooses `RS256` or `ES256`. |
| tokenType | Defaults to `at+jwt` (RFC 9068). Select `JWT` explicitly when the provider uses it, and require an API-specific audience. |
| clockToleranceSeconds | Defaults to 5 seconds, with a range of 0 to 60 seconds. Applied to time-claim checks. |
| exclusiveAudience | Defaults to false. When true, this becomes a publisher (machine) policy requiring exactly the specified audience in `aud`. |
| fetchImpl | Optional. A transport trusted by the host or a fetch implementation for isolated tests. |

A configuration error throws during creation and sends no network request. The prototype provides OIDC
sign-in and collapsed direct bearer entry. The real provider and API audience are undecided.

## Publisher (Machine) Verification

A server publisher uses a verifier port separate from the administrator. It does not substitute the administrator verifier, and a
token role or project grant is not used as publishing authorization.

- `createWorker(adminVerifier?, publisherVerifier?)` — accepts the publisher verifier as the second port.
  Without a publisher verifier, only `POST /v1/projects/{projectId}/server-batches` is closed with 401.
- `createOidcWorker(adminOptions, publisherOptions?)` — when both are supplied, their audiences must differ;
  equal audiences are rejected at creation.
- `createPublisherOidcWorker(publisherOptions)` — Publisher only. It does not open administrator routes.
- The publisher verifier is created with `exclusiveAudience: true`. After signature verification, it passes only when `aud` is
  the one configured audience string or a one-element array containing that value; a token containing another audience is
  rejected. The administrator verifier keeps the existing include policy.
- An invalid token, null, or malformed principal returns 401, while public-key provider failures, timeouts, and capacity errors return the
  existing `storage_unavailable` 503. On success, only `{issuer, subject}` is passed through, and tokens and claims are neither stored nor logged.
- After the publisher verifier passes, the collector checks the D1 `project_publishers` authorization again. An owner or reader
  administrator grant does not confer publishing authorization.

`runtime.ts` and `config.ts` read `PUBLISHER_AUTH_MODE` (default `disabled`) and the `PUBLISHER_OIDC_*` keys and attach this verifier.
The server route is closed in the default configuration. Real provider values and production audience registration and deployment have not
been done. Setting-key rules are in [Runtime and Deployment Preparation](./runtime.md).

## Token and Authorization Policy

It verifies the signature and `iss`, `aud`, and `exp`, and requires `iss`, `sub`, `aud`, `exp`, and `iat`.
It verifies `nbf` when present and rejects a future `iat`, `exp <= iat`, and an empty or over-512-character `sub`.
The default profile is a JWT access token. ID tokens are not used for administrator authentication.
Opaque tokens, introspection, and automatic discovery are not supported.

It requires `kid` and rejects symmetric-key algorithms, unsigned tokens, and `jku` or `x5u` in tokens.
On success it returns only `{ issuer, subject }`. Email, name, and token roles are not used as authorization;
the existing D1 `project_grants` is applied on every read. Verification details, claims, and tokens are not included in logs or
responses. Rejected token verification returns 401, public-key retrieval failure 503, and insufficient project authorization
returns 403. Calling a verifier directly preserves the default null return, while the collector can receive dependency errors and a private cause through the optional
`throwDependencyErrors`.

## Public-Key Retrieval and Cache

Userinfo, query, and fragment in the HTTPS address and redirects are rejected. Credentials, bearer tokens, and referrer are not
sent. A response is limited to 64 KiB and 32 public keys, and private-key fields are rejected.
A 5-second limit applies from headers through body reading.

Each verifier is limited to 2 running operations and 32 waiting calls. Caller deadline waiting is outside slot management,
and a fetch that ignores cancellation holds its slot until actual completion. Late responses have their bodies discarded.
Failure cooldown is recorded before waking the queue, so a late completion from the same operation cannot extend a cooldown recorded at the deadline or overwrite
a newer success. It does not forcibly stop the actual transport.

The public-key cache lifetime is 10 minutes. A new `kid` refresh is limited to 30-second intervals after a successful read,
and retries remain blocked for 30 seconds after a failed read. A new token immediately after a key change may be rejected during the refresh interval,
and a deleted key may remain for its cache lifetime. Propagation of per-token revocation or logout requires the provider's short access token lifetime
or a separate follow-up policy.

The host reuses Worker instances with the same configuration. It does not create a verifier per request or share verifiers across
different provider settings. The cache is not persistent authorization storage.

## Dependencies and Verification

It uses `jose ^6`, and the installed version is recorded in the lockfile. It is MIT licensed, has no additional runtime
dependencies, and is based on Web Crypto. It has no Cloudflare or D1 dependency and is not included in the core or SDK.
The SDK plus Sembom gzip size remains 2949 bytes.

With keys generated at runtime, it verified valid, tampered, expired, and missing-claim tokens, key refresh, failed-retry limits, and size and time
limits. It also verified real signature checking in the Worker and revocation of a D1 grant. Private
keys and bearer tokens are not written to files or logs. It was not verified with an external provider or production tokens.

References: [jose jwtVerify](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md),
[remote JWKS configuration](https://github.com/panva/jose/blob/main/docs/jwks/remote/interfaces/RemoteJWKSetOptions.md),
[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), and
[RFC 9068](https://www.rfc-editor.org/rfc/rfc9068).

## Browser Administrator Sign-In

To prepare the administrator and collector targets together with public login settings, use
`npm run install:prepare` from [Production Installation Configuration](./installation.md).
It checks that the issuer, account, service binding, and administrator origin match; provider registration is separate.

`apps/admin/src/auth` uses public-client OIDC. Without a client secret, it verifies Authorization Code with PKCE (S256), state, nonce,
and the ID token signature. The ID token confirms the login session, while only the access token is sent to `/v1`.
Project authorization is checked against the server's D1 `project_grants`.

| Build environment variable | Required | Description |
| --- | --- | --- |
| `VITE_OIDC_ISSUER` | Yes | HTTPS address of the trusted issuer. Userinfo, query, and fragment are rejected. |
| `VITE_OIDC_CLIENT_ID` | Yes | Public client identifier registered with the provider. Separate from the API audience. |
| `VITE_OIDC_SCOPE` | Yes | Space-separated scopes. Must include `openid`. |
| `VITE_OIDC_RESOURCE` | No | Provider resource indicator. Sent for authorization, code exchange, and refresh; confirm its mapping to the API audience in provider settings. |
| `VITE_OIDC_ID_TOKEN_ALG` | No | `RS256` (default) or `ES256`. Separate from the server access token algorithm setting. |

The sign-in button is disabled when all three required variables are empty. Filling only some of them or using an invalid value
shows a configuration error. `VITE_` values are included in the public bundle, so do not put secrets there.
The real provider, client ID, scope, resource, and API audience values are **UNDECIDED**.

The administrator screen's `origin + /auth/callback` must be registered with the provider in advance. The screen allows
sign-in only over HTTPS or local HTTP on localhost, 127.0.0.1, or [::1]. Provider discovery,
token, and JWKS addresses must use HTTPS and support S256. Discovery, token, and JWKS requests require
the administrator origin to be allowed by CORS. The host must route `/auth/callback` to the SPA and route
same-origin `/v1` to the collector connected to the authentication verifier.

The callback code, state, and error are removed from the address before the first render. Only one-time state, nonce, verifier, and
configuration identifiers are kept in sessionStorage for at most 10 minutes and consumed before the code exchange.
Access and refresh tokens exist only in memory, so refreshing the page requires signing in again.
`oauth4webapi ^3` loads as a separate chunk when the sign-in screen is entered.

API requests near expiration wait for one shared refresh. If a refresh token exists, it must be rotated to new tokens;
if refresh fails or the same token returns, the session is cleared and sign-in is required again.
Without a refresh token, the user signs in again after the access token expires. Cancelling one request does not cancel another request's
shared refresh. Disconnecting or switching to sample mode clears requests and local tokens.
Provider logout and token-revocation calls have not been implemented.

Tests use keys generated at runtime and isolated provider responses to verify signatures, nonce and state, duplicate callback handling,
rotating refresh, and cancellation. The real provider's CORS behavior, JWT access token issuance, resource and audience
mapping, rotating refresh, and production deployment have not been verified.

The optional `verify:admin-login` walks through the real administrator app, Chrome, and a local collector and D1 from the sign-in button through
the authorization redirect, callback, authenticated API read, and shared rotating refresh. It also checks refresh failure, invalid state,
sign-in again, and page refresh, filling provider responses in the browser without external communication. Execution and
isolation scope are in the [administrator login verification guide](../../tools/browser-bench/ADMIN-LOGIN.md).
