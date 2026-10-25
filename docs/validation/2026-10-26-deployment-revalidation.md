# Deployment Revalidation — 2026-10-26

Status: The touched-row ingestion guard is deployed. The optional pre-D1 limiter
code is deployed but inactive. Five-minute remote 12 and 16 requests/s runs
completed at 3,600/3,600 and 4,800/4,800 HTTP 200 responses.

## Deployment

Source commit `9f92c62` deployed Collector version
`abecfc07-3648-4f4d-9159-abf351d00298` and administrator version
`098a20ae-046f-4947-95cd-56037c1d8744`. Each Worker reported 100%. The
authentication Worker was unchanged.

The prepared bundle in `.tmp/production-20261026-revalidation/` reused the
existing production variables, D1 databases, service bindings and compatibility
dates. The configured administrator build passed, followed by successful
deployment dry runs for both Workers. Cloudflare remained on Workers Paid with
the Standard usage model.

The ingestion guard that compares touched receipt, workflow-attempt and
funnel-run rows now runs in production. The optional pre-D1 limiter code is also
present but remains inactive. Production has no `BROWSER_INGEST_LIMITER` binding,
no required flag, and no selected namespace or request threshold. The existing
D1 per-minute and daily project quotas remain active.

No API, DB schema, SDK, dependency, CI or authentication-Worker change is
included in this deployment.

## Remote checks

The deployment and authentication evidence files
`.tmp/revalidate-deployment-20261026.json` and
`.tmp/revalidate-auth-20261026.json` recorded these results:

| Surface | Result |
| --- | --- |
| Administrator | HTTP 200 |
| Authentication health | HTTP 200 |
| Authentication JWKS | HTTP 200 |
| Public site | HTTP 200 |
| 8ailors | HTTP 200 |
| Unauthenticated identity access | HTTP 401 |

The actual administrator entry asset `/assets/index-CEJ0UHFT.js` returned
HTTP 200, and its SHA-256 matched the prepared build. The final version check
reported `deploymentsUnchanged: true`; Collector
`abecfc07-3648-4f4d-9159-abf351d00298` and administrator
`098a20ae-046f-4947-95cd-56037c1d8744` remained at 100% after the load
runs. A cleanup revision advanced from 1175 to 1180 during observation, which
shows progress without proving that every cleanup operation succeeded.

One login attempt used the locally stored initial credential and received HTTP
401. Login and protected reads were therefore not revalidated. This record keeps
the limited observed fact, **stored initial credential rejected**, and does not
infer a service authentication regression. No password reset or password change
was performed.

## Completed load validation

Each five-minute run used four disposable projects sharing one D1, 20 events per
batch (six complete three-step funnels and two page views), a replay on every
fifth request, zero automatic retries, a 64-request client concurrency cap, and
stop-on-failure behavior.

| Target | HTTP | Accepted / duplicate | Client p95 / max | Max active | Response window | Requests/s | Accepted events/s |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| 12 requests/s, 300 s | 3,600/3,600 | 57,600 / 14,400 | 1,127.2165 / 2,223.9432 ms | 25 | 300,900.091 ms | 11.9641 | 191.4257 |
| 16 requests/s, 300 s | 4,800/4,800 | 76,800 / 19,200 | 1,216.4103 / 1,870.1588 ms | 29 | 300,378.1123 ms | 15.9798594 | 255.6777503 |

Together the runs completed 8,400/8,400 HTTP 200 responses and accepted 134,400
events with 33,600 duplicates, no HTTP 503 and no request failures.

Every 12 requests/s project retained 14,400 receipts and 14,400 events with 4,320
funnel runs; all three step totals were 4,320. Every 16 requests/s project
retained 19,200 receipts and 19,200 events with 5,760 funnel runs; all three step
totals were 5,760. The eight load projects, four per phase, were paused before
their integrity reads.

The retained tails covered 2,387/3,602 (66.3%) and 2,664/4,802 (55.4769%). They
observed 254 and 307 conflicts, zero exhaustions, maximum attempt 1, and no
failed invocations. These are partial observations, not full censuses.

Closeout confirmed all 10 projects paused, including the two probe projects, with
no matching guard or Wrangler-tail process remaining. The site, 8ailors and
account-login surfaces returned HTTP 200, and the final version check retained
both Workers at 100% on the same versions.

Schema, migrations and resource bindings were unchanged. Synthetic writes were
isolated to the ten test projects. The load generator did not target
`zerodi-site` or other existing production projects, and before/after row
counts for those datasets were not compared. The record includes one
authentication attempt with the stored initial credential, which returned 401;
no password reset or change was performed.

The result extends the earlier verified 8 requests/s five-minute workload to 16
requests/s under one-client, same-D1 conditions. It does not establish maximum
capacity, an SLO, multi-region behavior or long-duration stability.

## Validation and rollback

Application source was unchanged, so the prior source results remain applicable:
Collector 202 passed, installation/runtime checks 32 passed, and type checks
passed. Those source checks were reused for this documentation-only update;
the 69 contract checks passed again on 2026-10-26. Earlier 2026-10-25 single-project and distributed
results remain historical records of the previous deployment.

Rollback is available through previous Collector version
`b6498981-83b7-4fd9-b736-404cf91e8f0c` and administrator version
`470beb08-390c-437a-aed4-7b9feb7ff411`, without a schema or binding change.
