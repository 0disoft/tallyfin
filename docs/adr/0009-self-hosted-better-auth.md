# ADR 0009: Self-hosted administrator authentication with Better Auth

Status: Accepted (2026-10-25).

## Decision

Provide an optional first-party `apps/auth` Cloudflare Worker using Better Auth
and its OAuth provider plugin, both within major version 1. This replaces the
undecided administrator provider for the initial installation. External OIDC
providers remain supported through the existing Collector verifier boundary.
The browser and server SDKs do not depend on Better Auth.

The administrator remains an OIDC public client: authorization code with S256
PKCE, exact `/auth/callback`, rotating refresh tokens, ES256 ID/access tokens,
and a five-minute access token for the administrator origin's `/v1` resource.
The issuer is the authentication origin plus `/api/auth`. Existing identity
and project authorization continue to use the verified issuer and subject,
never an email address as a substitute for a token identity.

## Ownership and security

Authentication owns a separate D1 database (`AUTH_DB`). The Better Auth v1
schema snapshot is `apps/auth/migrations/0001_auth.sql`; it is separate from
the analytics schema in `db/schema.dbml`. Framework upgrades must compare the
upstream schema and migrate this database deliberately. Never run analytics
migrations against the authentication database or vice versa.

Public signup, dynamic client registration, client management, password reset,
and JWT session-token minting are closed. Private bootstrap creates one
administrator and one fixed public PKCE client. Session creation checks the
configured administrator email, including privately inserted extra accounts.
The operator grants project-creation privileges separately after verifying
`GET /v1/identity`; authentication alone grants no analytics permission.

Use HTTPS, Secure/HttpOnly/SameSite=Lax session cookies, bounded login bodies,
database rate limiting, origin checks and a restrictive CSP. Do not persist raw
IP or user agent in sessions. Rate-limit keys use a keyed IP pseudonym; this is
abuse-prevention metadata, not anonymous analytics, and must remain isolated.
Disable invocation logs, URL query recording and automatic traces because
authorization URLs carry codes and state. Log only fixed error codes.

The signing/encryption secret is a Worker secret, never public build settings.
The initial password and its hash must not enter chat, logs, Git or the public
installation bundle. Password handoff is operator-local. No OpenID Foundation
membership or hosted authentication subscription is required.

## Operations and verification

Deploy the authentication Worker with its own migrations and secret, then the
Collector and configured administrator assets. Keep publisher authentication
disabled until a separate publisher identity is configured. Changing issuer or
resource requires a coordinated installation and client registration update.

Tests cover closed signup, idempotent bootstrap, account restriction, real
PKCE/code exchange, refresh rotation, replay refusal, acceptance by the existing
Collector verifier, and native Workers/D1 login. Local tests do not establish
remote deployment; record live checks separately in `VALIDATION.md`.

Rollback to a previously verified Worker version preserves the auth DB. Do not
drop the database to roll back code. Existing issued access tokens expire after
five minutes; incident recovery may also require rotating the secret and keys
and revoking sessions and refresh tokens. No automatic destructive down
migration or authentication fallback is provided.

### Free-plan scheduling

The initial account has no remaining Cron slots. Optional
`collector.scheduler=auth-alarm` replaces additional Cron triggers with one
auth-owned SQLite Durable Object alarm. It calls a named Collector service-binding
RPC every minute, preserving the existing bounded cleanup and DB ownership.
Default installations retain Cron. The configured administrator explicitly arms
the clock through a same-origin session-protected control; status exposes only
timestamps and a success flag. Store the next alarm before dependency calls and
continue after failures. No new scheduled CI runner or paid upgrade is required.
