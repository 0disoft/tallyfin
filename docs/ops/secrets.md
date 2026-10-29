# Secrets

Status: production credentials are configured outside Git in the verified installation. This document
defines handling rules; it is not a fresh secret scan or proof of a managed-vault deployment.
Recovery on a separate device and whole-service failover remain unverified.
See [current state](../validation/2026-10-29-current-state.md).

## Public Configuration and Secret Separation

| Category | Examples | Where it is handled |
| --- | --- | --- |
| Public configuration | Project ID, issuer, API audience, JWKS URL, public OIDC clientId, administrator sign-in build input | Installation bundle and sign-in JSON |
| Secrets | Administrator access and refresh tokens, server publisher bearer tokens and the credentials used to obtain them, provider signing private keys, Wrangler API and OAuth authentication | Host storage, outside the repository |
| Restricted material | Production SQL backups and administrator audit history (not tokens, but access-restricted) | Access-controlled storage |

Browser sign-in build inputs (VITE_ values) are intentionally included in the public bundle. The
entire installation bundle, by contrast, contains operational target values such as the account,
service, and administrator origin, so the file is access-restricted as a whole.

- The installation bundle is closed JSON and rejects unknown keys as well as keys named secret,
  token, or clientSecret. It cannot use semantics to reject a secret pasted into an allowed string
  field such as clientId or audience. There is no automatic secret scan; a person reviews public
  field values.
- Do not put the bundle itself in a static-asset directory.
- Administrator sign-in uses a public-client Code+PKCE flow (S256) and does not use a client secret.
  Tallyfin verifies only the provider's public JWKS keys and does not store the provider's private
  keys.
- The server SDK does not persist tokens and calls the host's getToken for every attempt. That token
  is a bearer obtained by the host, and clientSecret is not passed to Tallyfin. The host is
  responsible for choosing the actual issuer and issuing credentials.

## Browser Token Storage

- Administrator access and refresh tokens exist only in the instance memory `#tokens`. The accepted
  access token's `expires_in` is capped at 24 hours, while the provider determines the actual
  expiration. The provider determines the refresh-token lifetime and requires rotation under the
  refresh rules below.
- The only value written to storage is the sessionStorage key
  `tallyfin.oidc.transaction.v1`. It validates state, nonce, PKCE verifier, configuration, and
  createdAt with a 10-minute TTL.
- This TTL is for validation and is not a scheduled automatic deletion. `complete()` deletes the
  transaction before awaiting the callback, and `destroy()` deletes it when clearing state. If a tab
  remains open without a callback or `destroy()`, an old entry can remain.
- `ApiClient.destroy` clears `#token`, `#getBearer`, and controllers, then calls onDestroy. There is
  no provider logout or revocation endpoint. Releasing references and aborting operations is not
  evidence of safe deletion from OS memory or protection against XSS or malicious extensions.
- The callback entry code removes code, state, and errors from the address before discovery and
  rendering. Provider and proxy logs are outside our deletion control.
- The PKCE verifier and authorization code are sensitive transient values and must not appear in
  reports or logs. A PKCE transaction remains valid for 10 minutes; the provider determines the
  authorization code's lifetime.
- Refresh requires a rotated refresh_token. A refresh failure or ambiguous result clears the local
  session and is not replayed. There is no provider-wide revocation call. The manual bearer used by
  the administrator API lives in private instance memory.

## Repository and CI Blocking

- `.gitignore` excludes `.env`, `.env.*`, `.dev.vars`, `.dev.vars.*`, `.tmp`, and
  `.wrangler`, and allows `.env.example`. Exclusion is not encryption, does not erase committed
  history, and does not hide already tracked files or backups retained in history.
- Even when an untracked `.env` is supported, do not put secrets in `.env.example` or VITE_ fields.
- `admin:build-configured` does not read `.env` or surrounding VITE_ values (`envDir` false and
  `envPrefix` []) and uses only the validated sign-in JSON. It writes output only to exclusive
  admin-assets.
- The current checkout's `.github` contains only a commented CODEOWNERS file and issue and PR
  templates; there is no Actions workflow. The remote CI secret store and rotation tooling were not
  inspected, so their state is UNDECIDED and unverified.
- VITE_ values are included in the public bundle, so do not put secrets in them.
- The mode 0600 and 0700 values requested for generated files do not guarantee Windows ACLs. OS ACLs
  and encryption are managed separately by the operator and are UNDECIDED.

## Input and Logging Rules

- `install:access-check` accepts an already-issued bearer only from non-interactive standard input
  (`--token-stdin`). It does not retain the token in arguments, files, conversation, reports, or
  logs, and it rejects TTY input.
- Do not put tokens, source data, or raw error text in output. Do not paste or even retain a hash of
  an exposed secret value; refer only to non-secret output file hashes, fixed codes, and credential
  references.
- Completion observation log projection removes URLs, queries, headers, and principals and keeps
  only fixed fields. Do not use a source secret value or secret hash as a general log identifier.
- Do not dump credentials, dump the shell environment, or print a credential list.

## Lifecycle and Inventory

- Keep an access-controlled, least-privilege inventory of credential reference, owner, purpose,
  provider, audience, scope, expiration, and rotation time. Do not use source secrets or secret
  hashes as ordinary identifiers. SHA-256 of artifact files such as the preparation bundle is
  allowed.
- The current source packages have no API-key vault or rotation scheduler. There is no automatic
  rotation or revocation worker either. Do not invent schedules, operators, or credentials that do
  not exist.
- The storage backend for a vault or KMS is UNDECIDED.
- If a provider-specific token command is needed, check the provider's source documentation first.
  This document does not create a new CLI; it connects provider responsibilities to the existing
  operational runbooks.

## Exposure Response

- Stop confirmed exposure first within the already approved scope (stop the exposure path, writer,
  and sharing).
- Revoke provider tokens and verify access separately, then inspect grants, publishers, and creator
  permissions in D1. Do not investigate by disabling authentication. Do not claim that deleting a
  public clientId invalidates tokens that were already issued.
- If only the last owner is compromised, `last_owner` prevents revocation or demotion. Block the
  exposed administrator path, establish an independently verified trusted owner first, and then
  revoke. Do not resolve it by disabling authentication or bypassing the invariant.
- Because JWKS is cached for 10 minutes and there is a 30-second cooldown, key rotation does not
  immediately invalidate cached tokens and logout is not revocation. Existing JWTs can remain valid
  until provider revocation, expiration, or cache-key policy takes effect; D1 authorization denial
  is separate. SQL restoration can revive revoked permissions, so recheck them before switching
  traffic.
- Preserve only the minimum source data under access control, and follow
  [incident response](./incident-response.md) for detailed procedures.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- Required validation names: [VALIDATION.md](../../VALIDATION.md)
- Release blocking status: UNDECIDED
- Remaining operational risk: UNDECIDED

## Evidence

- [OIDC](../backend/oidc.md), [installation](../backend/installation.md), [server SDK](../backend/server-sdk.md)
- [Incident response](./incident-response.md), [release](./release.md), [backup and restore](./backup-and-restore.md)
