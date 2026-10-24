# ADR 0008 — Shared Schema Drafts Owned by the Project Owner

Status: Local implementation. Remote migration and deployment require separate approval.

A draft file alone is hard to continue after a refresh or on another device. Add one row per project to the existing D1 database and allow only the administrator owner to read and conditionally save it. Readers and publishers cannot access it. A draft is not a published definition, so incomplete JSON and invalid version input are preserved as entered.

Use GET/PUT with `/v1/projects/{projectId}/schemas/draft`. Creation uses expectedRevision=null, and an update requires the 32-character revision last read and issues a new revision on every save. Permission rechecks and CAS and result queries run in the same D1 batch. The database decides contention, so the rule also applies across Workers and devices. Follow the [D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
A repeated request with a stale revision returns 409. An uncertain save is not retried automatically; an explicit query checks its contents. On conflict, show the server draft and current input, then let the user choose the next action.

Saving is an explicit action and does not include auto-save, publishing, version reservation, or review confirmation. Do not overwrite another owner's draft without notice, and loading a draft requires confirmation to replace current input and a new validation and privacy review. File functionality remains independent. Savable content has the same existing 128KiB download-file budget, and server input is limited to 129KiB to allow for packaging overhead.

The draft text an administrator writes is control-plane data separate from event and visitor raw data. It is shared among owners, kept as one row for the project lifetime, and included in backups. Deleting a project cascades to its draft. The screen warns users not to include personal data or secrets, and request and response bodies and draft text are excluded from logs, aggregates, and administrator change history. Do not confuse this with the existing 90-day aggregate retention. Delete APIs, history versions, automatic merging, and version reservation are outside this scope.

Extend the database first, then deploy the Collector and administrator. When rolling back to older code, keep the new table so drafts are preserved. Production application and backup-retention changes were not run for this local implementation.
