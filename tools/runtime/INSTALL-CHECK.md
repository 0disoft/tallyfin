# Public Provider Check — `install:check`

```powershell
npm run install:check -- --dir <prepared-installation>
```

The command first revalidates the five files in the installation bundle created by `install:prepare`.
It rejects modified files, moved bundles, and unknown options before making a network request. It
supports only `--dir` and `--help`. Use real provider values confirmed by the operator.

It GETs public OIDC discovery and JWKS, and sends only a diagnostic OPTIONS request to the token
endpoint. An endpoint on the same origin as the administrator does not need CORS headers, and its
OPTIONS request is also skipped. When issuer authentication is enabled, it also reads the separately
configured JWKS. Signing keys may expose only public fields, and the command checks the algorithm,
use, kid, and actual import. RSA keys must be at least 2048 bits, and ES256 keys must use P-256.

The command enforces HTTPS, rejects address credentials, queries, and fragments, rejects redirects,
omits credentials, and uses no-referrer and no-store. Each request has a 5-second limit, the CLI has a
45-second total limit, response bodies are capped at 64 KiB, and JWKS is capped at 32 keys. A
transport that ignores cancellation still stops waiting, and response-stream cleanup does not delay
the check result. Requests are sent only to endpoints specified in the reviewed installation bundle
or declared by the provider, so do not use this as a server API that checks untrusted configuration
on someone else's behalf.

The output is `tallyfin.install-check/v1` JSON. Each entry in `checks` contains `id`,
`status(pass|fail|unknown)`, `required`, and `code`. `publicChecksPassed` is true only when all
required checks pass, and the exit code is then 0. A required failure or unknown result, or an input
failure, exits 1. `--help` exits 0. The command does not output source configuration, response
bodies, keys, addresses, or identifiers.

The token OPTIONS request is diagnostic only and is not evidence of an actual code exchange or token
refresh. An OPTIONS failure remains a non-blocking unknown. `operationalReadinessVerified`,
`remoteChanges`, and `tokensRequested` are always false, and `manualRequired` lists follow-up
checks. Real registration of the provider's public client, callback, origin, scope,
resource/audience, and JWT type, plus sign-in, refresh, production Worker, D1, Cron, and initial
administrator permissions, must be verified separately. Passing the required public checks does not
mean production is ready.

The command performs no sign-in, code exchange, token issuance, client registration, Cloudflare
call, database access, deployment, or file write. Distinguish network-fixture checks from real
provider checks. The current real-provider check has not been run; follow the
[installation guide](../../docs/backend/installation.md).
