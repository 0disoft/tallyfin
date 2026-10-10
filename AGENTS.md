# AGENTS.md

## Repository Scope

Scope: fullstack

This repository owns backend, frontend, API contracts, DB contracts, product specs,
engineering standards, and operational standards.

API request and response shapes are sourced from `api/openapi.yaml`.

DB structure is sourced from `db/schema.dbml`.

## Repository Shape

- Primary repository type: monorepo
- Addons: none

- monorepo: This repository type owns workspace boundaries, package ownership, dependency policy, and change coordination.


## Source of Truth

- Product scope: docs/product/02-spec.md
- Architecture decisions: docs/adr/*.md
- Validation: VALIDATION.md
- Agent routing: .agents/context-map.md
- Repository hygiene: .editorconfig, .gitattributes, .gitignore

## Hard Rules

- Do not infer production application code from generic scaffold examples. The admin source lives in `apps/admin/` under ADR 0007. Sample data remains a demo and does not prove operational authentication or deployed analytics.
- Do not invent technology choices. Use UNDECIDED when a decision is not known.
- Do not create fake credentials, tokens, secrets, or private values.
- Do not rely on generated, cache, or build output as source truth.

## Repository Hygiene

- .editorconfig sets line ending, encoding, and final newline policy.
- .gitattributes sets Git text normalization and binary diff policy.
- .gitignore excludes local, secret, build, and cache artifacts.
- Generated, cache, and build output must not be used as design-document evidence.
- Do not create large diffs that only change line endings.

## Before Editing

- Read this file, VALIDATION.md, CHECKLIST.md, and .agents/context-map.md.
- Read the skill and checklist named by the context map.
- Confirm source-of-truth documents before changing contracts.

## Out of Scope

- Deployment, credentials and infrastructure provisioning without explicit authorization.
- Framework apps beyond the selected React/Vite admin, native fetch collector and portable TypeScript packages.
- Project-specific credentials or deployment secrets.

## Final Response Requirements

- List executed validations, passed validations, skipped validations, skip reasons, and remaining risk.
- Name any source-of-truth documents changed.
- Call out API, DB, repository hygiene, and runner changes explicitly.
