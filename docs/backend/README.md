# Tallyfin Backend Contracts

Status: v0.1 contracts finalized. The core, storage adapters, collector, browser SDK, server publishing SDK, and administrator read API have been implemented and verified locally. Local Node, Miniflare Worker, and D1 integration have also been verified. Production deployment and a real identity provider do not exist yet.

Public browser collection and authenticated administrator reads are separate. Requests and responses follow
[OpenAPI](../../api/openapi.yaml), the storage structure follows [DBML](../../db/schema.dbml),
and behavioral semantics follow the [Event and Aggregation Contract](./event-contract.md).

There are no raw event or visitor tables; daily events and entry cohorts are aggregated.
For local operation and preparation of production targets, follow [Running the Collector](./runtime.md).
The local [Project Registration and Authorization Management CLI](./provisioning.md) supports preview, registration, grant, and revocation.
The settings write API has been implemented, and [Server Events](./server-events.md) has been implemented through source-specific storage adapters that recheck core batch validation and
publishing authorization. Authenticated server HTTP ingestion and the server publishing
SDK have been implemented locally, and local Node, Miniflare Worker, and D1 integration have also been verified. Connecting a real identity provider,
issuing tokens, and production deployment remain follow-up work.
Passing format validation is not proof that API execution, atomic storage, or production authorization have passed.
