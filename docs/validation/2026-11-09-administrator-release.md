# Administrator Release — 2026-11-09

Status: The administrator Worker was rebuilt from pushed commit
`0352ff48d946309c9ca94d75d50207e891c6bb4c` and deployed at 100% traffic. Collector, auth, D1,
secrets and other resources were not changed. Collector/auth versions, bounded-load evidence and the
remaining operational gaps stay as recorded in [Current State — 2026-10-29](2026-10-29-current-state.md).

## Release input

- Source: `0352ff4` (`chore(admin): upgrade Saylo to stable 0.1.0`), clean tree, equal to
  `origin/main`. Installed Saylo packages resolved to 0.1.0, matching the lockfile.
- Installation input: the validated snapshot `.tmp/production-20261029-e46ef03/installation.json`,
  regenerated into the new directory `.tmp/production-20261109-0352ff4`. The regenerated
  `installation.json`, `admin-login.json` and `oidc-registration.json` are byte-identical to the
  previous preparation; only the absolute assets path differs in `admin.wrangler.json`.
- Deployment scope: administrator only. Collector `tallyfin-collector`, auth, D1 and the service
  binding target were referenced, not deployed. No secret was written or rotated.

## Checks

- `install:prepare` completed with no remote changes.
- `admin:build-configured` built 513 files (21,964,798 bytes) into the new `admin-assets`.
- `admin:dry-run` packaged a 1.84 KiB Worker script with bindings `ASSETS` and
  `COLLECTOR` → `tallyfin-collector`.
- The first deploy attempt with the ambient `CLOUDFLARE_API_TOKEN` failed at the assets upload session
  with `No access to the specified resource`; Worker read endpoints worked with that token, so the
  failure was an asset-write authorization gap, not account selection. The deploy used the existing
  `CLOUDFLARE_WORKERS_DEPLOY_TOKEN` environment variable instead. No token or secret value was printed
  or changed.

## Deployment

| Item | Value |
| --- | --- |
| Deployment | `e86f9b90-c383-45d6-a65d-07386d0cc864` |
| Version | `516eade5-3ddc-4326-9378-e5b783195b6e` (version 9) |
| Traffic | 100% |
| Created | 2026-11-09T09:15:39Z |
| Message / tag | Release 0352ff4 / `0352ff4` |
| Script etag | `7994165a…` — equal to the previous version |

The unchanged script etag shows the Worker script, compatibility date (`2026-08-06`) and worker-first
routing (`/v1`, `/v1/*`) are carried over; the release changed static assets. `--keep-vars` was used.
No plaintext vars existed before the deploy and none were added.

## Production reads

- `/` returned 200 and was byte-identical to the local `admin-assets/index.html`.
- `/assets/OidcLogin-Cq30kIUx.js`, `/assets/HelpTerm-B7oiWqxP.js` and
  `/assets/admin-BSwWOwrp.js` returned 200 and matched the local SHA-256.
- The served login chunk still contains the configured OIDC issuer, audience resource, scope,
  password-change URL and ES256 ID-token algorithm.
- `/v1/health`, `/v1/identity` and `/v1/projects?limit=1` returned the expected 401 JSON error
  envelope; an unknown `/v1` path returned the 404 envelope.

## Not verified

Sign-in, token refresh, D1 writes, collector ingestion and Cron were not exercised because this release
changes admin assets only. No API, DB, dependency, CI/runner or repository hygiene change was made. The
`.tmp` evidence directories are local and are not shipped.
