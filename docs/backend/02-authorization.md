# Project Authorization

Status: Grant checks and the local project registration and authorization management CLI have been implemented and verified locally.
User registration in a real identity provider and remote production deployment do not exist yet.

`GET /v1/identity` returns only the caller's own account. It requires a verified administrator bearer token and does not require a project
grant. This route does not access the database, read other accounts, or grant permissions.
The administrator app can explicitly read and copy it from `Check signed-in account`, and the route remains available when the project list is
empty. Authorization registration is performed separately by a trusted operator.
The [Remote Creator Authorization Tool](./remote-creator-provisioning.md) pins the administrator issuer and
target database of a verified installation and changes only creator authorization, using a preview hash and a condition on the state immediately before the write.
This authorization does not replace an existing project read grant or server publishing authorization.
Every administrator project read checks `project_grants` for the verified issuer and subject. Every D1 read
attaches `EXISTS (project_grants ... role IN ('reader','owner'))` to the statement, and definition, version reads, and aggregation use one batch snapshot. Readers and owners can read;
only owners can use settings PATCH and schema publishing PUT. Project creation POST requires a separate
`project_creators` authorization and count limit; it is not inferred from an existing owner.
The creator's initial owner grant is granted only in the same atomic write as project creation. Revoking creator authorization does not delete
existing `project_grants`. The local [registration and authorization management CLI](./provisioning.md) is
run by a trusted operator with access to the database file, and it does not check sign-in or the owner role.
It supports first-owner registration and protection of the last owner. Authorization is not obtained from a UI
selection, cursor, or public projectId. The project list returns only accessible projects in ascending
ID order (default limit 25, maximum 100, cursor), and authorization is reapplied on every page. Missing or invalid authentication is 401, insufficient grant for the project is 403, a missing definition or version is
404, and a storage error is 503.

The ingestion boundary checks project active status, registered version, browser source, origin, and limits.
Because ingestion is public, bot authenticity is not guaranteed, and the IP abuse prevention policy must be defined before activation.
See the [Administrator Read Boundary](./administrator.md) and [Event Contract](./event-contract.md).
