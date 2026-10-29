# Operational Contract

Status: an initial installation and repeated manual deployments are verified. SLOs and alert recipients remain undecided. See [current state](../validation/2026-10-29-current-state.md) for component versions, dated evidence and remaining operational gaps; implementation limits below do not create new targets.

## Core User Journeys

1. Browser collection: a page sends a batch, and the batch is reflected in the aggregates.
2. Server collection: a server SDK sends a batch with a publisher token, and the batch is reflected in the aggregates.
3. Administrator reads: an owner or reader signs in and reads metrics for each project.
4. Administrator writes: an owner changes settings, schemas, grants, or publishing permissions, and the change history is preserved.
5. Expiration cleanup: a scheduled run deletes old rows.

## Priorities

1. Tenant isolation and authorization boundaries.
2. Collection accuracy, minimizing duplicates and loss.
3. Availability of administrator reads and writes.
4. Cleanup and retention.
5. Observability.

## Dependency Layers

| Layer | Component | Local evidence | Production status |
| --- | --- | --- | --- |
| 1 | D1 (storage) | Storage adapter and migrations `0001`–`0014` | Initial remote migrations and backup/restore verified; check the target head before upgrades |
| 1 | OIDC verification (authentication) | Ephemeral signed-token tests | Better Auth administrator login verified; publisher OIDC disabled |
| 2 | Collector Worker | Local workerd tests | Deployed; bounded remote 12/16 requests/s checks passed |
| 2 | Administrator Worker and proxy | Proxy and browser smoke tests | Deployed; dated manual release checks recorded |
| 3 | Cleanup scheduling | Scheduled/alarm tests | Durable Object alarm progress verified; no production cleanup SLO |
| 3 | Observability logs | Bounded structured-log tests | Logs deployed; automated alert delivery and operational dashboard not configured |

## Implementation and Verification Boundaries

- Fourteen migrations, `0001`–`0014`, define 17 application tables. The source head is
  `0014_saved_schema_drafts.sql`. The current-state version recheck does not query the remote database schema.
- The recovery drill `verify:restore` uses only a local synthetic database. On local D1, it passed
  aggregation for 20-second successful and 3-second failed attempts, the ordering where an
  `error=range` termination arrives first, and matching administrator workflow results after
  restoration and retransmission (7c2fab8). This is not evidence for a production RTO or RPO.
- Installation/inspection tools have local fixture checks. Initial operational checks and later
  deployments have separate dated evidence; a pass from one tool does not validate the others.
- Production logs consist of a one-line completion observation and cleanup logs. There is no
  dashboard or alert recipient.
- The code contains an administrator-only `GET /v1/health` read probe. It accepts only a verified
  administrator bearer and reads `projects` and `project_grants` with
  `SELECT 1 ... LIMIT 1`; on success it returns
  `{status:'ok', scope:'administrator_storage_read'}`. This proves only that the two
  control-plane tables can be read at that moment. It does not prove collection writes,
  aggregation, all tables, Cron, log completeness, or overall service health. There is no
  production probe schedule or designated alert recipient. Production OIDC and deployment have separate evidence.

## Release Blocking Conditions

- A SHA-256 mismatch in the preparation bundle, or a modified or moved file.
- An unknown migration head, or a mismatch between local and remote state. The current head is
  `0014_saved_schema_drafts.sql`.
- No confirmed backup before applying a migration.
- Exposure of personal information or secret values.
- Failure of an authentication or authorization gate (issuer, audience, PKCE, owner/reader, tenant).
- Failure or lack of confirmation for a required check.

These are the same conditions as the [release runbook](./release.md); this document adds no new gate.

## Undecided Items

- SLO, RTO, and RPO: UNDECIDED.
- Primary and backup owners, escalation path, and alert recipients: UNASSIGNED and UNDECIDED.
- Thresholds and log retention period: UNDECIDED.

Do not invent numerical targets until evidence exists.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- Required validation names: [VALIDATION.md](../../VALIDATION.md)
- Release blocking status: UNDECIDED
- Remaining operational risk: UNDECIDED

## Evidence

- [Release runbook](./release.md), [rollback runbook](./rollback.md), [incident response](./incident-response.md)
- [Operational observability](./observability.md), [backup and restore](./backup-and-restore.md)
