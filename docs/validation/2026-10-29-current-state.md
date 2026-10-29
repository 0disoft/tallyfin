# Current State — 2026-10-29

Status: This is the current summary for source, deployment and bounded load evidence. Earlier validation
records remain historical evidence. This document does not turn a local change into a deployed one.

## Source and deployment

The last pushed commit is `2460e269467bd2977fc05a57008448212ffe2aba`. Administrator version
`074da2bc-2453-45d5-b401-2f4ca18b7ba4` was deployed from that commit. Collector
`abecfc07-3648-4f4d-9159-abf351d00298` and auth `dcf73e41-bd30-4efd-86dc-fa428c6077fa` were retained
from earlier deployments rather than built from `2460e269`.

| Surface | Version | Traffic |
| --- | --- | ---: |
| Administrator | `074da2bc-2453-45d5-b401-2f4ca18b7ba4` | 100% |
| Collector | `abecfc07-3648-4f4d-9159-abf351d00298` | 100% |
| Auth | `dcf73e41-bd30-4efd-86dc-fa428c6077fa` | 100% |

A remote read-only check at `2026-10-29T12:51:39.210Z` reported Administrator
`074da2bc-2453-45d5-b401-2f4ca18b7ba4`, Collector `abecfc07-3648-4f4d-9159-abf351d00298`, and Auth
`dcf73e41-bd30-4efd-86dc-fa428c6077fa`, each at 100%. It also observed publisher authentication
disabled, `BROWSER_INGEST_LIMITER_REQUIRED` absent, and no rate-limiting bindings. The read-only
evidence is `.tmp/site-capacity-remote-status-20261029.json` and is not shipped.

Feature commit `fd994fab0131f4b1d5f33780de68c4c108769ef8` and this documentation change remain local.
That feature commit is not pushed and is not included in the deployment above.

## Load and verification evidence

The 2026-10-26 remote load check used four disposable projects sharing one D1, 20 events per batch, a
replay on every fifth request and no automatic retries. Each phase ran for 300 seconds from one client.

| Target | HTTP 200 | Accepted / duplicate | Client p95 |
| --- | ---: | ---: | ---: |
| 12 requests/s | 3,600/3,600 | 57,600 / 14,400 | 1,127.2165 ms |
| 16 requests/s | 4,800/4,800 | 76,800 / 19,200 | 1,216.4103 ms |

The 16 requests/s phase made 4,800/4,800 HTTP 200 requests and retained 19,200 receipts per test
project, with 5,760 runs at each of three funnel steps. The 12 requests/s phase retained 14,400 receipts
per project and 4,320 runs at each step. Synthetic writes were confined to disposable projects, which
were paused only after the runs; ingestion rejects paused projects.

These runs are bounded evidence for a single client, one D1 and five minutes. They are not maximum
throughput, a production SLO, long-duration stability or multi-region evidence. The raw `.tmp` logs are
local working artifacts and are not shipped. Earlier 12 and 16 requests/s failures against the previous
ingest path remain historical records; they are not erased, and they do not describe the changed path.

## Operations

Remote migrations and a one-off encrypted backup/restore for the analytics and Better Auth D1 databases
were verified. Repeated manual deployment is now verified. Automated backup cadence and RPO,
whole-service failover, recovery with another Windows account or device key, multi-region behavior and
the production SLO remain unverified; the SLO is UNDECIDED.

The optional pre-D1 browser request limiter code is deployed but inactive. Production has no limiter
binding, required flag, selected namespace or threshold. Existing D1 request and daily receipt limits
remain the active quota controls.

Publisher OIDC is disabled in the latest local bundle and in the remote configuration. There is no
operational server-authentication proof and no verified production token lifecycle. Better Auth remains a
single-administrator deployment by design. The latest load record did not revalidate password login;
its stored test credential returned 401, which is not by itself evidence of a service authentication
regression.

The existing encrypted D1 restore was performed under the same Windows account and established that the
backup and restore procedure works in that environment. It does not prove whole-service recovery,
another device's key availability or recovery after losing that Windows profile.

## Multilingual site generation

The generator feature is locally implemented and verified in commit
`fd994fab0131f4b1d5f33780de68c4c108769ef8`. Thirteen focused checks, root TypeScript checking, and the
new fixture CLI run passed. The 12-language, 32-tool generated client completed a real SDK and local D1
replay through both the first and eighth workflows, recording success and failure. The probe produced the
following counts without changing the small-input schema:

- 12 locales and 4 tools: 1 workflow and 5 events, with the existing IDs.
- 12 locales and 5 tools: 2 workflows and 8 events.
- 12 locales and 32 tools: 8 workflows and 26 events.
- 32 locales and 10 tools: 10 workflows, within the limit.
- 32 locales and 11 tools: a structured capacity error.

`locales x tools x 5` is compared with 256. When it is over budget, tools are partitioned in input order
into `floor(256 / (locales x 5))` tools per group. The first group retains `tool_usage`, `tool_started`,
`tool_succeeded` and `tool_failed`; later groups append `_2`, `_3`, and so on. Every group retains the
full locale enum and only its assigned tools. The generated `startTool(tool, locale)` helper maps a tool
to its workflow, so callers keep the same public helper. Consent withdrawal, cancellation and retrying
the same event ID and body are unchanged.

`page_view` uses `locales x pages` separately and still rejects more than 256 combinations. The existing
maximums remain 10 workflows, 50 events, 32 enum values per property and 256 combinations per event.
The generator does not raise those limits.

New-site output has nine files: `registry.json`, `project-create.json`, `schema-draft.json`,
`schema-publication.review.json`, `browser-config.json`, `template-config.json`, `capacity-report.json`,
`analytics.ts` and `requests.json`. `capacity-report.json` records `limits`, `eventCount`, `workflowCount`,
`schemaBytes`, `schemaDraftBytes`, `schemaPublicationBytes`, `requestedFailureCombinations`, and each
event's `name`, `factors` and `combinations`. Capacity failures report the resource, computed actual
count, limit and optional factors.

`template-config.json` includes `workflowGroups` and `representativeWorkflowId`. A single group uses its
workflow ID; multiple groups use `null`. A multi-group registry omits `representativeWorkflowId`, so the
administrator Overview cannot present the first group as the whole site, and Goals lists every group for
selection.

Count and enum limits are not the only limits. Request schema files are pretty when they fit and compact
when whitespace crosses the budget: the compact JSON plus newline must fit 32 KiB for `schema-draft.json`
or 33 KiB for `schema-publication.review.json`. A 12-language, 32-tool fixture with ordinary IDs produced
about 26.2 KiB of pretty draft JSON. In the boundary test, 32 short language enums with 10
tools pass and 11 tool groups fail the workflow limit. Thirty-two long locale tags with 10 tools can still
hit a 32 KiB limit even after compaction, so maximum dimensions do not guarantee that arbitrary-length
identifiers fit. These serialization fallbacks do not change the policy budgets.

Grouping applies only to newly generated schema 1 sites. Existing published sites keep their IDs and
require an explicit migration with a fresh privacy review. The generator does not automatically rewrite,
publish or split an existing site.
