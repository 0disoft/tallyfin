# Risk Register (03)

Status: Cross-checked against sources and design documents on 2026-10-21. It distinguishes implemented mitigations from risks that must be verified in operations. Local validation details follow [VALIDATION.md](../../VALIDATION.md). No validation results yet exist for actual providers, remote DBs, or service pilots.

| Risk | Description | Current mitigations | Remaining decisions and verification |
| --- | --- | --- | --- |
| Loss | Loss due to tab close/blocking/send failure | Implemented browser 5-second send, up to 2 retries per 10 minutes, and hidden keepalive send | Verify loss and runtime cost in actual services and on mobile |
| Duplication | Duplicate counting due to retransmission | Implemented per-source 48-hour receipts, hash collision checks, and atomic storage | Verify failures and retransmission in a remote environment |
| Spam | Public project IDs and origin gates cannot prevent bots | Implemented per-project per-minute request and UTC daily new-ingest limits plus input restrictions | Additional bot-blocking methods and temporary IP policy are UNDECIDED |
| Privacy | Risk of storing raw text/results/URLs/identifiers | Implemented allowing only registered attributes, fixed-field observation logs, and minimal state retention | Review actual service schemas, logs, and host configuration |
| Admin draft | Risk that mistakenly entered personal information or secrets are shared with other owners and remain in backups | Implemented explicit owner-only storage, 128KiB, one row per project, exclusion from body logs, and CAS, and provides sharing-scope guidance before saving | Verify operational owner management and backup retention/deletion procedures. The draft is administrator control-plane raw text, not a visitor event |
| Cardinality | Explosion of registered attribute combinations | Implemented limits of at most 4 attributes, 32 types per definition, and 256 combinations | Measure per-service operational limits and actual distribution |
| Project isolation | Exposure of another service's data | Implemented OIDC verification, reader/owner, separate creator/publisher permissions, and rechecks at storage time | Verify actual provider configuration and remote permissions |
| Meaning and version | Event definitions with the same name differ | Implemented immutable schema versions, concurrent publication conflict checks, per-source aggregation, and cross-version definition comparison | Apply the service schema change procedure; aggregation comparison across different versions is follow-up. Definition comparison is not a compatibility determination |
| Cohort | Completion rate is misleading due to event division | Implemented start-date cohort, once per attempt, null for a 0 denominator, and project-time-zone queries | Review the start/completion definitions of actual work |
| Publication source | Browser and server record the same success twice | Implemented dedicated server endpoint, publisher authentication, permissions, SDK, and per-source lookup | Connect actual publisher tokens and the service's success confirmation point |
| Linking limitation | Mistaking a task funnel for user tracking | Implemented 2–10-step browser/server task funnels, a 24-hour progress window, and a 72-hour linking status | Actual service pilot. Linking existing workflows across refreshes/devices is follow-up |
| Storage | Shared D1 write load and retention/recovery failure | Implemented 90-day daily aggregation, bounded cleanup, and local load/recovery tools | Verify remote Cron, operational load, backup/recovery, and RTO/RPO |
| Vendor | Collection/storage implementation depends on Cloudflare | core/SDK-independent adapter | Storage adapter for another hosting environment |
| License | Open-source intent but undetermined | Distribution prohibited until the license is finalized | License type |

Privacy details follow [ADR 0003](../adr/0003-minimal-privacy-preserving-events.md); the current contract follows [Product spec](02-spec.md); and the implementation sequence follows [Roadmap](01-roadmap.md).
