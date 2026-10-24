# Administrator Sign-In Verification — `verify:admin-login`

This starts the real administrator application source with Vite and takes a headless browser through
OIDC sign-in, rotating refresh, and disconnecting. It uses only an isolated Miniflare collector and
D1 and signing keys generated during the run, and opens no external network access. It is not
connected to `npm run check` and is run only when needed. Check the result on standard output each
time it runs.

## Installation and Execution

Use Node 24 or later and install the root and measurement-folder dependencies separately.

```powershell
npm ci --ignore-scripts
npm ci --prefix tools/browser-bench --ignore-scripts
npm run verify:admin-login
```

```powershell
npm run verify:admin-login -- --channel chrome
```

Playwright is a development dependency (`^1`) installed only in `tools/browser-bench`; it is not
included in the SDK, collector, or default CI checks. To use Chromium, first download the dedicated
browser with the installation command in the
[measurement tool guide](./README.md). The tool does not install a browser automatically during a
run and does not use a personal browser profile. If the browser executable cannot be found, choose a
channel or install Chromium.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--channel` | `chromium` | Accepts exactly one of `chromium`, `chrome`, or `msedge`. Any other value fails at the `arguments` stage. |
| `--help` | | Prints usage without running. |

## What It Checks

This tool executes the [Vite administrator app](../../apps/admin/README.md) and the
[browser administrator sign-in](../../docs/backend/oidc.md#browser-administrator-sign-in) contract as
written.

- From the administrator sign-in button, it goes to provider authorization and returns to
  `/auth/callback`. The authorization request uses PKCE S256 and does not include
  `code_verifier`.
- The callback code and state are removed from the address before the first render. The code is
  exchanged once, the nonce matches the ID token, and the ID token signature is verified.
- After the exchange, localStorage, sessionStorage, and cookies are empty at each step.
- An administrator bearer can query `/v1`, and **Storage Read Check** in settings reads
  `GET /v1/health`.
- Advancing only the browser wall clock to the access-token refresh time makes requests wait for one
  shared refresh, and the refresh token rotates.
- If the refresh token fails, the session and token are cleared and sign-in is required again. Error
  body text sent by the provider does not remain on screen.
- A callback with the wrong state is rejected without exchanging the code.
- After `Disconnect` or a reload, the token store is empty and sign-in is required again.

## Isolation

- The administrator UI runs the real source (`apps/admin`, `vite.config.mjs`) through the Vite
  development server. `VITE_OIDC_*` values are injected at run time. It does not read `.env` or the
  caller's sign-in values, and the collector proxy is fixed to an isolated loopback address. It does
  not modify production configuration files in the repository.
- The provider is `https://identity.example.invalid`, and discovery, JWKS, authorize, and token
  responses are filled directly in the browser context. Requests to other origins are aborted, and
  the application opens only loopback addresses.
- The RS256 signing key and refresh token exist only in memory and are not written to files or logs.
- The collector uses the actual runtime bundled with esbuild into an isolated Miniflare workerd and
  temporary D1. It registers a project with the example registry and gives the signed-in principal
  owner permission. It disables only the bridge's sample logging output and does not change the
  production collector's logging setup.
- The temporary D1 directory (`.tmp/admin-login-*`) is deleted at the end on success, failure, or
  Ctrl+C.

## Output

It writes one JSON line to standard output. It creates no screenshot or report files.

On success, it includes `verified: true`, the browser version, fixed booleans
(`pkceRedirect`, `signedApiAccess`, `callbackScrubbed`, `sharedRotatingRefresh`,
`refreshFailureClears`, `invalidStateRejected`, `disconnectClears`, `relogin`,
`reloadClears`, `storageEmpty`, and `noAdminWrites`), `pageErrors`, and fixed counts
(`authorizations`, `exchanges`, `refreshes`, and `apiReads`). On failure, it prints only
`{"verified":false,"stage":"..."}` and exits with code 1. `stage` is one of `arguments`,
`setup`, `login`, `refresh`, `refresh-failure`, `disconnect`, `bad-state`, `relogin`,
`reload`, or `cleanup`, and only reports where it stopped. Code, state, tokens, identity, request
bodies, and addresses are included in neither success nor failure output. After 60 seconds, browser
work is aborted and treated as a failure. Server, browser, and temporary database cleanup runs after
that, so actual process exit can take longer.

## Remaining Real-Provider Verification

The provider verified here is a synthetic one created during the run. Real-provider CORS allowance,
discovery and JWKS addresses, JWT access-token issuance, resource/audience mapping, and real rotating
refresh have not been verified. Remote collector operation, production deployment, push, and deploy
are also outside this tool's scope. Build variables and provider registration conditions are
documented in the [OIDC connection guide](../../docs/backend/oidc.md#browser-administrator-sign-in) and the
[administrator application guide](../../apps/admin/README.md).
