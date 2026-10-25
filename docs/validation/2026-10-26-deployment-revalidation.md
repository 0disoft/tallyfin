# Deployment Revalidation — 2026-10-26

Status: The touched-row ingestion guard is deployed. The optional pre-D1 limiter
code is deployed but inactive. Remote 12 and 16 requests/s capacity revalidation
is pending.

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

One login attempt used the locally stored initial credential and received HTTP
401. Login and protected reads were therefore not revalidated. This record keeps
the limited observed fact, **stored initial credential rejected**, and does not
infer a service authentication regression. No password reset or password change
was performed.

## Validation and rollback

Application source was unchanged, so the prior source results remain applicable:
Collector 202 passed, focused Collector checks 32 passed, contracts 69 passed,
and type checks passed. They were reused rather than rerun for this
documentation-only update.

The five-minute remote revalidation for 12 and 16 requests/s across four
projects sharing one D1 was running from current `main` when this record was
written. No result or capacity claim is made while it is pending. Earlier
single-project and distributed results describe the previous deployment.

Rollback is available through previous Collector version
`b6498981-83b7-4fd9-b736-404cf91e8f0c` and administrator version
`470beb08-390c-437a-aed4-7b9feb7ff411`. The database remains unchanged.
