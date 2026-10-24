# Development Guide

Status: In addition to the design documents, v0.1 contracts, and sample administrator UI, core validation, the D1 storage adapter, the minimal browser collector, the browser SDK, the server publishing SDK, and the administrator query API have been implemented and verified locally. The Sembom integration example exists only in this repository and has not been installed or activated in the actual Sembom repository. There is no real identity provider, remote database migration, or production deployment yet. Local Node, Worker, and D1 integration for the server SDK has also been verified.

## Reading order

1. [Product specification](./docs/product/02-spec.md) and [architecture](./ARCHITECTURE.md)
2. [Documentation index](./docs/README.md)
3. [ADR 0002: Contract source of truth](./docs/adr/0002-contract-source-of-truth.md)
4. [ADR 0003: Minimal, privacy-first events](./docs/adr/0003-minimal-privacy-preserving-events.md)
5. [Workspace boundaries](./docs/monorepo/workspace-boundaries.md), [package ownership](./docs/monorepo/package-ownership.md)
6. [Event and aggregation contract](./docs/backend/event-contract.md), [collector implementation](./docs/backend/collector.md)
7. [Browser SDK](./docs/backend/browser-sdk.md), [administrator query boundary](./docs/backend/administrator.md)
8. [Risk register](./docs/product/03-risk-register.md)
9. [Frontend design](./docs/frontend/FRONTEND_DESIGN.md)
10. [VALIDATION.md](./VALIDATION.md)

## Local commands
Run these from the repository root.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run check
```

`typecheck` uses `tsc --noEmit` to check the core, storage, collector, browser SDK, and server publishing SDK sources, the `examples/sembom` example, and the `tools/provision` CLI source. `test` runs tests for `packages/core`, `packages/storage-d1`, `packages/browser`, `packages/server`, `apps/collector`, and `tools/provision`. `check` adds `check:browser-size` to those checks. Storage adapter tests apply `db/migrations/0001_initial.sql` to Miniflare D1 to verify atomic commits, CAS guards, duplicates, quotas, and cleanup. Collector tests invoke an esbuild-bundled Worker in Miniflare to verify the HTTP boundary, including delivery of the Sembom example's 6 events and workflow and duplicate handling on retransmission. `test:core` runs only core tests, `test:browser` runs only browser SDK tests, and `test:server` runs only server publishing SDK tests.

The root checks also cover the `tools/runtime` runner source and tests. The integrated runtime test starts the administrator server, and `apps/admin` dependencies are installed with the root lockfile.

Development-only contract checks live in a separate package.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

The browser and server SDKs, the Sembom example, and distribution size checks also run from root commands.

```sh
npm run test:browser
npm run build:browser
npm run test:server
npm run build:server
npm run check:browser-size
```

`build:browser` produces an esbuild bundle and `tsc` type declarations, and `check:browser-size` checks that the example schema projection matches, verifies the bundle boundary, and enforces the 3KiB gzip budget. `test:server` and `build:server` run unit tests and produce the bundle and type declarations for the server publishing SDK. SDK behavior is documented in the [browser SDK](./docs/backend/browser-sdk.md) and [server SDK](./docs/backend/server-sdk.md), and execution results and measured values are in [VALIDATION.md](./VALIDATION.md).

## Next implementation
Local implementation of the browser SDK and administrator query API is complete; the remaining work is operational. The expired-cleanup scheduled handler and local registration and permission management CLI are also implemented. Server event ingestion and the server publishing SDK are implemented locally, and local Node, Worker, and D1 integration for the server SDK has been verified. Connecting a real identity provider and remote D1 migration and schedule registration are follow-ups. Initial runtime cost and real-browser latency, throughput, and remote deployment have not been verified yet. Contract and command state is recorded in [VALIDATION.md](./VALIDATION.md).
The administrator UI run and verification commands are in the [administrator README](./apps/admin/README.md).
Real browser login verification runs through the optional `verify:admin-login` command and requires a separate Playwright installation and browser executable. Follow the [login verification guide](./tools/browser-bench/ADMIN-LOGIN.md).
API connections use same-origin `/v1` for queries, settings, permissions, and schema publishing.
For production configuration and the public login build, follow the [installation guide](./docs/backend/installation.md).

## No fake commands
To run the administrator and collector together, run `npm run dev -- --local --state-dir .tmp/collector-db`.
Install the root dependencies and prepare the database first with the registration CLI below. The default ports are 5180 for the administrator and 5188 for the collector. For run, proxy, and shutdown procedures, follow [Integrated development run](./docs/backend/runtime.md#integrated-development-run).

Run the collector with `npm run collector:dev -- --local --state-dir .tmp/collector-db`.
Initialize the same directory with the registration CLI first, then register a project.
For runtime configuration, deployment file preparation, and bundle checks without upload, see [Collector runtime](./docs/backend/runtime.md).
`typecheck` generates Wrangler binding types and checks shared code and platform integration code.
`collector:types` and `admin:types` create the output folder `.tmp` first. In a new clone or an environment where you unpacked the source, you do not need to start the development server first or create the folder manually.

Local project registration and permission management start with `npm run provision -- --help`.
The default is a preview, and initialization, registration, and permission changes require `--apply`.
For input formats, commands, and recovery procedures, follow the [registration and permission management CLI](./docs/backend/provisioning.md).

Do not assume production commands, CI, or credentials. Run only commands that actually exist in the repository's package.json.

## Measuring browser SDK cost

After installing the development tool with `npm ci --prefix tools/browser-bench --ignore-scripts`,
run `npm run bench:browser -- --channel chrome --samples 5` to connect a local browser, collector, and D1 for a measurement. This is not part of the default checks or CI. Installed Edge and a dedicated Chromium build are also selectable. Follow the [run and measurement guide](./tools/browser-bench/README.md).

## Local Git
Commit only the changed files in small units of work. Push, deploy, and publish within the scope the user requested.

## Source limit
If a single file exceeds 40KiB, review whether it should be split.
