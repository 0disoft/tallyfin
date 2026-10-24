# Operational Contract

Status: documentation-only draft. No production deployment, established SLO, or designated alert recipient has been provided. The figures below are confirmed properties of the current implementation; they do not create new targets.

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
| 1 | D1 (storage) | Storage adapter and migrations `0001`–`0013` verified with Miniflare | Not applied to a remote database |
| 1 | OIDC verification (authentication) | Verification with ephemeral signed tokens and local D1 | No real provider |
| 2 | Collector Worker | Verified with local workerd | Not deployed remotely |
| 2 | Administrator Worker and proxy | Verified with a local proxy and smoke tests | Not deployed remotely |
| 3 | Cron cleanup | Verified with a local scheduled run | Cron Trigger not registered |
| 3 | Observability logs | Verified locally | No log collection, dashboard, or alerting |

## Current Local-Only Evidence

- Thirteen migrations, `0001`–`0013`, create 16 application tables. The current head is
  `0013_workflow_failure_reasons.sql`, and it has been applied only in Miniflare.
- The recovery drill `verify:restore` uses only a local synthetic database. On local D1, it passed
  aggregation for 20-second successful and 3-second failed attempts, the ordering where an
  `error=range` termination arrives first, and matching administrator workflow results after
  restoration and retransmission (7c2fab8). This is not evidence for a production RTO or RPO.
- The installation and inspection tools (`install:prepare`, `install:check`,
  `install:database-check`, and `install:access-check`) have been verified only locally and with
  fixtures. They have not touched a real provider, remote database, or remote writes.
- Production logs consist of a one-line completion observation and cleanup logs. There is no
  dashboard or alert recipient.
- The code contains an administrator-only `GET /v1/health` read probe. It accepts only a verified
  administrator bearer and reads `projects` and `project_grants` with
  `SELECT 1 ... LIMIT 1`; on success it returns
  `{status:'ok', scope:'administrator_storage_read'}`. This proves only that the two
  control-plane tables can be read at that moment. It does not prove collection writes,
  aggregation, all tables, Cron, log completeness, or overall service health. There is no
  production probe schedule, real-provider OIDC, alert recipient, or remote deployment.

## Release Blocking Conditions

- A SHA-256 mismatch in the preparation bundle, or a modified or moved file.
- An unknown migration head, or a mismatch between local and remote state. The current head is
  `0013_workflow_failure_reasons.sql`.
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
