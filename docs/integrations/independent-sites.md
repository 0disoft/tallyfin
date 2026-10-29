# Independent Site Integration

This guide covers a site in its own repository that sends browser events to an existing Tallyfin install. The
SDK distribution carries the browser and server tarballs, `SHA256SUMS`, `manifest.json`, this guide, the
site README and `site.example.json`. Running `site:prepare` is a separate local step and creates nine files;
the bundler does not run it or include that generated directory automatically. The site team needs the SDK
files to install the client, and the checked-in examples remain `.invalid` fixtures.

The ZIP may also include `tallyfin-connection.json`: public collector origin
`https://tallyfin-admin.rodisoft1.workers.dev`, `browserEndpointPattern` `/v1/projects/{projectId}/batches`,
matching `csp.connectSrcOrigins`, and `registrationRequired: true`. Its presence registers nothing. No
project ID or site domain was supplied, so no real site was registered and the prepared output stays an
`.invalid` fixture with `registrationVerified: false`. Use it as schema and consent-wrapper reference, then
use the config and `analytics.ts` generated for the registered project.

## Build the distribution (operator)

Run from a clean committed checkout; tracked or untracked changes abort, and the identity is rechecked after
packaging.

```sh
npm run sdk:bundle -- --out .tmp/sdk-distribution
```

It runs `verify:sdk-packages`: builds both SDKs, packs offline, installs into a temporary consumer outside
the checkout, and checks the exact file list, `LICENSE`/`NOTICE`, three ESM entry points, and declarations.
The new directory gets commit-suffixed tarballs, `SHA256SUMS`, this guide, `site.example.json`, and
`manifest.json` (`source.commit`, `source.tree`, `dirty: false`, artifact `sha256`/`bytes`,
`published: false`). The manifest is the completion marker. Both SDKs stay `private` at `0.0.0`; nothing
is published and versions do not change. SHA-256 proves bytes match the manifest; confirm the reviewed commit
first, since a checksum is not a signature.

## Install in the site

Verify every file in the extracted ZIP first, including this guide and `site.example.json`, then copy only
the tarballs. Use the exact filenames from `manifest.json`; PowerShell does not expand globs for external
commands.

```sh
sha256sum -c SHA256SUMS
```

```powershell
$m = Get-Content manifest.json | ConvertFrom-Json
foreach ($i in $m.artifacts + $m.guides) {
  if ((Get-FileHash $i.filename -Algorithm SHA256).Hash -ne $i.sha256) { throw $i.filename }
}
$browser = $m.artifacts | Where-Object name -eq '@tallyfin/browser'
New-Item -ItemType Directory -Force "vendor/tallyfin/$($m.source.commit)" | Out-Null
Copy-Item $browser.filename "vendor/tallyfin/$($m.source.commit)/"
npm install --offline --ignore-scripts --save-exact "./vendor/tallyfin/$($m.source.commit)/$($browser.filename)"
```

On POSIX systems, copy the same manifest `filename` values into `vendor/tallyfin/<source.commit>/` and
install that exact path. A browser-only site installs the browser tarball only. Install the server tarball
only where a publisher secret lives, and never in browser code. Apache-2.0 `LICENSE` and `NOTICE` are
inside each tarball.

## Prepare the registration plan (operator)

```sh
npm run site:prepare -- --file site.example.json --out site-example
```

The checked-in [12-language, 5-tool example](../../examples/independent-site/README.md#multilingual-fixture)
is a real preparation fixture:

```sh
npm run site:prepare -- --file examples/independent-site/site-multilingual.example.json --out .tmp/site-multilingual
```

It produces 2 tool workflows and 8 events: `page_view`, `language_changed`, and three
`tool_started`/`tool_succeeded`/`tool_failed` events per group.

Input is closed and at most 16 KiB:

- `project {id, name, timeZone}`: id `^[a-z][a-z0-9-]{0,47}$`, name 1-80 characters, IANA zone.
- `collectorOrigin` and 1-16 `allowedOrigins`: exact HTTPS origins without path, query, wildcard,
  userinfo, or trailing slash; allowed origins are sorted in the output.
- `locales`: 1-32 unique lowercase canonical BCP 47 tags (`en`, `ko`, `pt-br`), each at most 32
  characters. This reviewed list is the allowlist.
- `pages`, `tools`: 1-32 unique public enums matching `^[a-z0-9][a-z0-9_-]{0,31}$`; categories
  only, never URLs, queries, input, file names, or user IDs.
- `limits`: 1-600 requests per minute, 1-1,000,000 new receipts per UTC day.
- Each event allows 256 property combinations. `page_view` uses `locales x pages` and rejects values
  over 256. Tool workflows use `locales x tools x 5`; inputs over 256 are divided into groups as described
  below, subject to the other schema and generated-file byte limits.

It is offline and writes only to a new directory: `registry.json`, `project-create.json`,
`schema-draft.json`, `schema-publication.review.json`, `browser-config.json`,
`template-config.json`, `capacity-report.json`, `analytics.ts`, `requests.json`. This is schema 1
for a new project only.
Publication stays `privacyReviewed: false` with `expectedLatestVersion: null`; the template stays
`registrationVerified: false` with `privacyReviewRequired: true`. Supported languages exist only in the
`locale` enum property; there is no new database field.

Small valid inputs keep exactly one `tool_usage` workflow and the existing event IDs. When the
`tool_failed` combination count would exceed 256 (`locales x tools x 5`), tools are split in input order
into groups of `floor(256 / (locales x 5))`. The first group keeps `tool_usage`, `tool_started`,
`tool_succeeded` and `tool_failed`; later groups add `_2`, `_3`, and so on to the workflow and three tool
event IDs. Every group keeps the full reviewed `locale` and its assigned `tool` enums. The generated
`startTool(tool, locale)` helper selects the matching workflow automatically; its public signature,
consent, cancellation and same-ID retry behavior are unchanged.

For example, 12 locales with 5 tools produce 2 workflows and 8 events (2 page-level events plus 3 tool
events per group). 12 locales with 32 tools produce 8 workflows and 26 events. The result remains within
the existing limits of 10 workflows, 50 events, 32 enum values per property and 256 combinations per
event: 32 locales with 10 tools produce 10 workflows, while 11 tools return a structured capacity error.
`page_view` is not partitioned; `locales x pages` over 256 is rejected separately.

`capacity-report.json` records the applicable limits, event and workflow counts, compact schema and
generated request-file byte counts, the originally requested failure-combination count, and each event's
factor and combination counts. `schema-draft.json` is pretty when it fits and compact when whitespace
crosses the 32 KiB budget; compact JSON plus a newline must still fit. `schema-publication.review.json`
uses the same fallback and must fit 33 KiB. Thus 32 short locales with 10 tools pass, 11 tool groups fail
the workflow limit, and 32 long locale tags with 10 tools can still fail a byte limit after compaction.
Capacity errors report the computed actual count or byte size, limit and factors; these checks do not
raise the existing policy limits.

`template-config.json` includes `workflowGroups` and `representativeWorkflowId`. The latter is a string
for one group and `null` for multiple groups. A multi-group new site omits the registry-level
`representativeWorkflowId`, so Overview cannot present the first group as the whole site; Goals lists
each group for explicit selection. Grouping applies only when generating a new schema 1 site. Existing
published sites keep their IDs and require an explicit migration with a fresh privacy review; the
generator does not rewrite or publish them automatically.

Local D1 only:

```sh
npm run provision -- init --local --state-dir .tmp/site-local-db --apply
npm run provision -- register --local --state-dir .tmp/site-local-db --file site-example/registry.json
npm run provision -- register --local --state-dir .tmp/site-local-db --file site-example/registry.json --apply --expect-plan <planHash>
```

This CLI is not remote registration and mints nothing.

## Register once through the admin API (operator)

Creation needs a pre-provisioned creator permission; the creator becomes owner. Validation and publication
need an owner grant; readback needs reader or owner. The operator supplies the bearer token from the existing
authenticated boundary; this repository mints no token and assumes no admin password.

```js
// publish.mjs — call with the token held in memory. Never pass it via argv or print it.
import { readFile } from 'node:fs/promises';
export async function registerSite(token) {
  const plan = JSON.parse(await readFile('site-example/requests.json', 'utf8'));
  const base = new URL(plan[0].url).origin;
  const project = JSON.parse(await readFile('site-example/project-create.json', 'utf8')).id;
  const send = (method, path, body) => fetch(base + path, { method, redirect: 'error',
    credentials: 'omit', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body) });
  const body = async name => JSON.parse(await readFile(`site-example/${name}`, 'utf8'));
  const created = await send('POST', '/v1/projects', await body('project-create.json'));
  if (!created.ok) throw Error(`create ${created.status}`);
  const checked = await send('POST', `/v1/projects/${project}/schemas/validate`, await body('schema-draft.json'));
  if (!checked.ok || (await checked.json()).valid !== true) throw Error(`validate ${checked.status}`);
  const reviewed = await body('schema-publication.review.json');
  // Stop until a human records the privacy review and sets privacyReviewed to true.
  if (reviewed.privacyReviewed !== true) return { published: false };
  const published = await send('PUT', `/v1/projects/${project}/schemas/1`, reviewed);
  if (!published.ok) throw Error(`publish ${published.status}`);
  return published.json();
}
```

Each step is one request; add no automatic retries. A publish response carries `definitionHash` (SHA-256 of
the canonical stored events and workflows). If the response is lost, GET version 1 and compare the canonical
`events` and `workflows` (plus any `funnels` or `representativeWorkflowId`) with the reviewed publication
before reporting success. A read status alone does not prove the definitions match. Resend the identical body
only when the version is absent; identical retries are idempotent, and a different body returns 409.
`privacyReviewed: true` is the owner's explicit attestation; validation passing is not approval, and no
script sets it.

## Wire the browser client

```ts
import { setAnalyticsConsent, trackPage, trackLanguageChange, startTool } from './analytics';
setAnalyticsConsent(true);
trackPage('tool', 'ko');
trackLanguageChange('en');
const task = startTool('calculator', 'en');
task?.succeed(); // or task?.fail({ failure_reason: 'timeout' })
```

The wrapper creates no client before consent, reuses one client across routes, and accepts an optional
`host` port for tests. Consent withdrawal destroys the client, drops queued and in-flight events, and makes
old handles fail; later consent creates a fresh client. Accepted data remains and cannot be withdrawn.

Events are `page_view {locale, page}`, `language_changed {locale}`,
`tool_started|tool_succeeded {locale, tool}`, and `tool_failed {locale, tool, failure_reason}`.
`failure_reason` is exactly `validation`, `unsupported`, `dependency`, `timeout`, or `other`.
`startTool` starts the generated workflow containing the requested tool; terminal dimensions keep the
starting locale and tool even if the UI language changes mid-task. Do not send workflow phases with
`track()`. Do not read `navigator.languages` or map an unknown locale to English; pass the reviewed value
or skip the event.

`flushAnalytics()` only schedules delivery. Retries keep the same ID, time, and body. Collector receipts
give at-most-once aggregation for the same retained event ID; delivery can still be lost, so there is no
exactly-once guarantee. Receipts last 48 hours, not forever, and there is no durable queue; closing the tab
can lose pending events.

## Browser policy

Merge `template-config.json` `csp.connectSrcOrigins` into the site's existing `connect-src`, keeping
script and style sources and wildcards. The endpoint is the public administrator service, not the private
Collector binding, and its hostname may itself be a `workers.dev` address. CORS preflight must allow the
exact configured origins.

Status: prepare performs no remote request. No registration, privacy approval, token issuance, automatic
collection, or deployment is included; fixtures use `.invalid`.

