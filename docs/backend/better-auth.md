# Self-hosted administrator authentication

The optional `@tallyfin/auth` Worker runs Better Auth v1 and the OAuth provider
plugin in your own Cloudflare account. No paid identity-provider membership is
required. Cloudflare resource usage remains subject to your account plan.
The existing administrator uses the same OIDC client and Collector verifier;
no SDK or analytics API authentication format changes.

## Prepare the topology

Create separate analytics and authentication D1 databases. Prepare the existing
[installation bundle](installation.md) with these exact public login settings:

- Issuer: your authentication HTTPS origin followed by `/api/auth`.
- Client ID: `tallyfin-admin`; scope: `openid profile offline_access`.
- Resource and Collector audience: your administrator origin followed by `/v1`.
- Both token algorithms: `ES256`; Collector token type: `at+jwt`.
- Collector JWKS URI: your authentication origin followed by `/api/auth/jwks`.
- Redirect URI: your administrator origin followed by `/auth/callback`.

In a private, Git-ignored target JSON file, supply `workerName`, `databaseName`,
`databaseId`, `adminEmail`, `workersDev`, and optionally `domain`. The database
must differ from analytics. For workers.dev, the issuer's host must match the
authentication Worker name and your verified account subdomain. For a custom
domain, `domain` must equal the issuer's host.

```powershell
npm run auth:prepare -- --dir .tmp/installation --file .tmp/auth-target.json
npm run admin:build-configured -- --dir .tmp/installation
npm run test:auth
npm run auth:types
```

`auth:prepare` revalidates the existing five installation files and writes a
new `auth.wrangler.json` exclusively. It does not provision, create secrets,
log in, migrate or deploy. The authentication config is an additional reviewed
file; the original five-file installation format remains compatible.

## Bootstrap and deploy

Apply `apps/auth/migrations` only to `AUTH_DB`, and `db/migrations` only to the
analytics database, using each generated config and explicit `--remote`.
Create `BETTER_AUTH_SECRET` with cryptographic randomness and upload through
Wrangler secret input. Never place it in public build settings or shell arguments.

Bootstrap is private operator code: call `bootstrapSql` from
`apps/auth/src/bootstrap.ts` with the selected email, a new random UUID subject,
the administrator origin and a Better Auth `hashPassword` result. Submit the
returned SQL privately to the auth database, without logging it. Generate the
strong initial password in memory; deliver it through the operator's local
credential manager. SQL contains a password hash and must be protected too.
Bootstrap is idempotent and does not reset an existing password. It registers
one account and the fixed public PKCE client; it exposes no setup HTTP route.

Deploy the auth Worker with its generated config, then the Collector, then the
configured administrator assets. The Collector can have `workers_dev: false`
and remain reachable through the administrator's service binding for `/v1`.
Public signup and dynamic registration return 404. Only the configured email
can create an administrator session; no account can grant itself analytics roles.

Verify real PKCE sign-in, ID-token signature and audience, refresh rotation,
`GET /v1/identity`, storage health and project-list access. Use the verified
issuer and subject for `provision:remote-creators` to grant an explicit project
limit. Do not substitute the email or client ID for the subject. The first
project can then be created from the administrator screen.

Open `/sign-in` on the auth origin to change a password after signing in there.
Forgotten passwords require a private operator recovery; email reset is closed.
Do not overwrite a credential blindly. Recovery must revoke existing sessions
and refresh tokens, and existing access tokens can remain valid for five minutes.

## Data and operations

Auth stores account email, password hashes, session/refresh-token metadata and
encrypted signing keys in a separate D1. Session IP and user agent are null;
rate-limit keys use keyed IP pseudonyms for abuse prevention. An hourly Cron
removes rate-limit rows inactive for 24 hours (up to one additional hour before
the next cleanup). Logs contain fixed
failure codes, no request payloads. Automatic invocation logs, URL queries and
traces are disabled. The login UI uses the administrator's existing Korean UI
language. Better Auth dependencies are private to this workspace.

The migration is the Better Auth v1 schema snapshot described by
[ADR 0009](../adr/0009-self-hosted-better-auth.md). Review schema changes on
framework upgrades. Use a previous verified Worker version to roll back code;
preserve the auth database. Back up and recover auth separately from analytics.
Do not infer production health or a completed end-to-end service integration
from local tests, a public login page or an empty project list.
