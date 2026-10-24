# Incident Response

Status: documentation-only runbook. No automated alerting, dashboard, or health endpoint has been
deployed. Responders work directly from console operational logs, deployment records, and D1. This
document does not create new response tooling.

## Principles

- Evidence first. Separate verified facts from assumptions, and leave unknown values blank.
- Contain the incident first within the scope already approved. Stopping an exposed path or writer
  does not require a new approval. Seek separate approval only for new external changes outside
  that scope, such as redeployment, restoration, credential issuance, or provider adjustment.
- Collect only non-secret evidence: `requestId`, fixed `code`, operational counters, UTC time, and
  deployment version ID.
- Do not include request bodies, headers, paths, queries, IP addresses, tokens, or account
  identifiers in routine reports.
- Treat administrator change history and SQL backups as existing access-controlled material, and
  do not attach them verbatim to routine reports.

## First 10 Minutes

1. Record the UTC time, severity, and number of affected projects.
2. Inspect `http_request` lines in the operational logs for `operation`
   (`browser_collection`, `server_collection`, `administrator`, or `other`), `status`, `code`,
   `latencyBucket`, and `samplingDenominator`.
3. If a request failed, use the `requestId` in the response body to match that response with its
   log line.
4. If an administrator read fails with a JSON 503, inspect `admin_api_unavailable` in the
   administrator edge log, which indicates that the COLLECTOR binding is unavailable. This code
   identifies a JSON 503 on the `/v1` proxy path; it does not indicate that static administrator
   assets or the entire interface are down. The error body has no `requestId`; do not invent one.
   Collector 503 responses include `Retry-After: 1`.
5. Check the deployment version ID with `deployments list`.
6. If exposure or unauthorized access is confirmed, stop the affected path and writer first. Seek
   approval only when a new external change is needed and is outside the scope you can contain.

Log interpretation limits: successful requests are sampled at 1/64 while failures are logged in
full, so raw line counts cannot be used to calculate a failure rate or p95. `latencyBucket` is a
coarse distribution measured by a clock that advances only after I/O, so it is not evidence of total
response latency, CPU time, or an SLO. The absence of logs does not prove that no incident occurred.

## Severity (Based on Impact)

There is no numeric SLA. Response and recovery time targets are UNDECIDED and are not created here.

| Level | Criteria |
| --- | --- |
| S1 | Confirmed data exposure or unauthorized access, collection stopped across all projects, or widespread data corruption. Exposure or unauthorized access is S1 even when it affects only one project. |
| S2 | Collection stopped or incorrect for one project, or administrator writes are unavailable |
| S3 | Partial degradation, a workaround exists, and the impact is limited |
| S4 | Delayed observability or cleanup with no retention or data risk. If risk exists, raise the severity according to impact. |

## Branches by Category

### Collection Outage (Browser and Server)

- Split by `code`: `origin_denied` (browser Origin), `project_unavailable` (project status),
  `unknown_schema` (unregistered schema or version), `unauthorized` or `forbidden` (server
  publisher authentication or authorization), `quota_exceeded` (429, per-minute or daily limit),
  and `storage_unavailable` (503, storage).
- Inspect the fixed causes in the rejection diagnostic counters for the last seven UTC dates. There
  is no denominator, so a rejection rate cannot be calculated.
- **Project status `paused`**: browser and server collection stop after admission. Administrator
  reads and writes, the publisher registration and revocation CLI, and scheduled cleanup continue
  to run. `runCleanup` processes paused projects too. Do not treat "paused" as a complete stop.

### Administrator, Proxy, and Authentication

- If a `/v1` JSON 503 contains `admin_api_unavailable`, investigate the COLLECTOR service binding
  first. This diagnoses the proxy JSON path; it does not mean the static UI is entirely down.
  Investigate static-asset failures separately.
- For collector errors, distinguish 401 `unauthorized`, 403 `forbidden`, and 503
  `storage_unavailable`.
- The OIDC verifier caches JWKS for 10 minutes and uses a 30-second cooldown after a refresh
  failure. Deleting or rotating a key does not immediately invalidate cached tokens, and logout is
  not server-side revocation.
- Coordinate credential incidents with the provider and cache-key owners. In D1, preserve the
  observed `expectedRole` and `expectedGrantId` values and last-owner protection while revoking
  grants, publishers, and creator permissions. Do not claim that deleting a public client ID
  revokes tokens. Follow [OIDC](../backend/oidc.md) for details.

### Aggregation and Cleanup

- Daily events count browser and server sources separately. Workflow and funnel data use the
  `startedAt` cohort, which differs from event occurrence time. The counts remain provisional for
  48 hours after the end of the date in the project's time zone.
- Cleanup logs contain only `attempted`, `completed`, `failed`, and `cursorAdvanced`; they do not
  include deleted row counts. Failed projects can also advance the cursor, so
  `cursorAdvanced=true` is not evidence that all processing succeeded.
- Stopping collection, stopping Cron, and pausing a project are different actions. Stopping only
  Cron leaves collection running; stopping collection leaves scheduled cleanup and administrator
  writes running. Stop cleanup by removing the host Cron, and stop collection by blocking ingress
  and writers separately.

### Privacy Incident

- When exposure is confirmed, stop the exposure first. Stop the affected path and writer, and if
  necessary stop exposed keys and sharing. Containment within the already approved scope is
  immediate.
- Preserve fixed-field operational logs and existing administrator audit and SQL backups in an
  access-controlled location for the investigation. Do not attach source data, tokens, or
  identifiers to general reports.
- Seek separate approval only for new external changes outside the approved scope, such as
  redeployment, restoration, or provider adjustment.

## Do Not

- Do not disable authentication or authorization to debug an issue.
- Do not change an ID or timestamp to replay an event outside the stored eventId or replay window.
  `occurredAt` is accepted only from 24 hours before to 5 minutes after receipt; receipts expire at
  receipt plus 48 hours, and workflow and funnel data expire at start plus 72 hours. Do not move dates
  or rewind timestamps to bypass these limits.
- Do not backfill past periods or invent counters. Do not fill missing values with estimates.
- Tallyfin cannot reconstruct data loss when no source remains. If a host retains a legitimate
  source, that source can be used for recovery; report the scope of loss and whether the host has
  retained the source as separate facts.
- The browser SDK holds 40 events in memory and sends batches of 20. It retries at most 2 times, for
  3 total attempts, and only for statuses 0, 408, 429, and 5xx. Its TTL is 10 minutes. A true
  return from `track`, `succeed`, or `fail` means the event was accepted into the in-memory queue,
  not that it was stored. The server SDK defaults to `maxAttempts` 3 and
  `retryBudgetMs` 30000, with an upper bound of 10 minutes. A failed or interrupted batch may
  already have been stored, so preserve the original ID, timestamp, and body.

## Recovery and Resumption

- Restoration rolls back grants, receipts, and audit records revoked after the backup. Because a
  backup can revive revoked publishing permissions, recheck grants and the owner/reader boundary
  before switching traffic.
- Resume when tenant boundaries and owner/reader access are verified, new and duplicate counts
  match for browser and server traffic in an isolated verification project, and cleanup status is
  known. Follow the [rollback runbook](./rollback.md) and
  [backup and restore](./backup-and-restore.md).

## Handoff and Follow-up Record

- Timeline of detection, containment, and verification at each UTC timestamp.
- Draft impact update that separates confirmed from unconfirmed facts and contains no estimated
  figures.
- Evidence: `requestId` (not a secret), fixed `code`, counters, and deployment version ID.
- Containment actions taken, whether remote changes were made, and unresolved items.
- Closure basis: containment and verification results and whether resumption conditions are met.
- Prevention ownership: assign the root cause and follow-up actions to specific owners.
- Owners, alert recipients, and reporting targets are UNASSIGNED and UNDECIDED, and this document
  does not send any messages.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- Required validation names: [VALIDATION.md](../../VALIDATION.md)
- Release blocking status: UNDECIDED
- Remaining operational risk: UNDECIDED

## Evidence

- [Logging boundary](../backend/06-logging-and-observability.md), [operational observability](./observability.md)
- [OIDC](../backend/oidc.md), [project authorization](../backend/02-authorization.md)
- [Expiration cleanup](../backend/retention-cleanup.md), [backup and restore](./backup-and-restore.md)
- [Cloudflare Workers rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
