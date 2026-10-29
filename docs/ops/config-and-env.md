# Config and Environment

- Status: Collector runtime is deployed. The pre-D1 limiter remains inactive and publisher OIDC is
  disabled in the verified installation; see [current state](../validation/2026-10-29-current-state.md).

Collector settings, local commands, D1/OIDC binding validation, target config generation and
privacy-aware logging are defined in [Collector runtime](../backend/runtime.md).
`wrangler.jsonc` is the source for generated binding types and packaging checks. Remote
account/database identifiers and OIDC provider values must be supplied by the operator.
Generated target files validate syntax; ownership and availability require a separate remote check.

## Operational Contract

Treat configuration as a runtime contract with defaults, environment ownership, validation, reload policy, and drift handling.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: UNDECIDED
- Remaining operational risk: UNDECIDED
