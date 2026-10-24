# ADR 0007 — Ownership Boundary of the Administrator App

- Status: Adopted, local implementation. Production authentication and remote deployment are follow-ups.
- Date: 2026-10-11

## Decision

Move the user-selected design and the implemented and verified React 19 and Vite 8 administrator UI into `apps/admin`. Keep React, Recharts, Phosphor, the existing fonts, and the OIDC client. Do not duplicate a separate UI or rebuild it in another framework. This supersedes the undecided administrator framework in ADR 0001 while leaving the collector's native fetch and the SDK dependency boundaries unchanged.

The administrator app is the private npm workspace `@tallyfin/admin`. Its dependencies are managed in the root lockfile, and the app runs through the root administrator-specific run and verification commands and the existing integrated development supervisor. Backend NodeNext type checking and frontend bundler type checking are separate, and root typecheck runs both. The Sites adapter, packaging, and related tests move unchanged. Moving the app alone does not change the collection API, identity provider, database, or remote routing contracts.

`prototypes/admin` retains only the initial design QA and a notice about where it moved. There is one runnable administrator source. The default address and OIDC callback start in API mode, and samples are served only at the explicit `/demo` and `/demo/` paths. Do not mark production complete until real provider sign-in, deployment, and the service pilot have been verified.

## Verification and rollback

Verify `npm run check:admin`, root typecheck, and an actual local collector and administrator integration run. After changing the runtime path, verify the 401 JSON response, the SPA callback path, and shutdown of both servers. Reverting the migration commit must restore the source paths, run commands, and lockfile together, with no data change. Deployment is not part of this decision.

## Same-origin API path — 2026-10-11

The administrator Worker serves static assets and the `/v1` and `/v1/*` API together. The API is forwarded to a separate collector Worker through a fixed `COLLECTOR` HTTP service binding. Administrator and publisher authentication and project permission checks remain with the collector. It does not accept an arbitrary external URL as a forwarding target. Path, query, body, Authorization, and Origin are preserved, and the body is not buffered. The call happens once, with no redirects, automatic retries, or API cache.

`assets.run_worker_first` prioritizes API paths that conflict with static assets. The collector's response status, body, and headers are preserved, and API responses are `no-store`. A missing binding or a call exception returns a fixed `admin_api_unavailable` 503 JSON response, never HTML. Only app navigation such as callback and demo uses the existing HTML fallback, and a missing JS file returns 404.

The real target is supplied through `admin:config` with the operator-provided account, Worker name, and public entry point, and only new files are created. Configuration that points at its own Worker or has no public entry point is rejected. Production authentication, remote resources, and deployment are follow-ups. The same Worker can be deployed to Sites, but the default Sites hosting configuration has no `COLLECTOR` binding, so the production API connection is verified through the Wrangler configuration.

The compatibility date keeps the existing verification baseline `2026-08-06`. The current Miniflare rejects `2026-10-11`, so promotion is verified separately along with a tool update. Log and query redaction and disabled automatic invocation logs and traces keep the existing privacy policy, and the adapter does not write exceptions, raw requests, or tokens to logs.

Sources: [Service Binding HTTP](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/), [static assets Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).
