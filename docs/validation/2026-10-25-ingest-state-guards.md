# Ingest State Guards — 2026-10-25

Status: Local storage implementation and verification; not deployed. The existing remote Paid
8 requests/s results remain from the old deployment.

## Guard Behavior

`D1Store.commit` now guards only state used by the plan. Inside one atomic D1 batch it NULL-safely
compares existing `event_receipts`, `workflow_attempts`, and `funnel_runs` snapshot fields for
touched rows, and rechecks current project configuration, active schema, publisher authorization,
and live daily quota. `projects.ingest_revision` still increments on success, but revision equality
is no longer the CAS condition. A guard failure writes `-1` to `tallyfin_ingest_revision` and rolls
back the batch. The retry budget remains eight attempts; pure retransmissions still return from the
read without writes. No DB schema, API/SDK signature, dependency, CI, or remote change is included.

## Verified Local Checks

The committed code (`4827a03`) passes 88 storage cases; one additional aligned existing-funnel race
passed separately, for 89 unique storage cases. The earlier 31-case storage/server/funnel pass also
succeeded. Root `tsc --noEmit` passed. The focused
contention/storage run passed 24 checks, including 16 distinct aligned writers each succeeding on
the first attempt and four distinct writers producing four snapshots and four writes with zero
conflicts. The four- and sixteen-writer cases reported exact 4/16 snapshots plus 4/16 writes and
zero conflicts. Same-event retry counts once; existing attempt null-to-terminal and quota races
remain covered. A file-based comparison against commit `1e41884` used the same four-writer
alignment harness for both versions: the old adapter made 10 snapshots and 10 write attempts with
6 conflicts; the current adapter made 4 snapshots and 4 writes with zero conflicts. Both accepted
8 events. Database batch calls fell from 20 to 8 (60%) in that deterministic scenario. This is
an operation-count comparison, not a throughput or latency measurement. Initial stdin launches
stalled and were stopped before successful file-based verification.

Collector/browser/server SDK integration passed 21 checks. An EXPLAIN QUERY PLAN check confirmed
primary-key index lookups for touched receipts, workflow attempts and daily quota, with no scan of
the receipt or attempt tables. Final results are in [VALIDATION](../../VALIDATION.md#sdk-lifecycle-portable-builds-and-ingestion-state-guards--2026-10-25).

## SDK Setup and Admin Builds

- `62f993a`: generated browser setup comments retain one application-lifetime client and reserve
  `destroy()` for consent withdrawal; it discards queued and in-flight events. Generated setup with
  the real SDK passed 10 checks, browser diagnostics passed 4, and size budgets were unchanged.
- `e6a2df1`: admin `build` is Vite only; `build:sites` runs the ordinary build plus Sites
  preparation; root `build:admin:sites` was added; `check:admin` uses the Sites build before bundle
  and Sites tests. A fresh tracked copy excluding `.openai` built the ordinary admin with installed
  dependencies, and the Sites build plus 11 Sites and 2 bundle tests passed.

## Remaining Evidence

The guard is not deployed, and remote 12/16 requests/s revalidation is pending. Local DB operation
counts do not establish a new sustainable rate. Additional state checks add indexed reads within
the write transaction; remote latency, billed rows and capacity still need measurement.
