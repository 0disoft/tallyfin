# Product Brief

Status: Initial design. This is a plan before measurement, implementation, and operational validation.

## Problem
Across multiple Rodisoft services, we want to verify in a common way whether users complete key tasks and where errors concentrate. We need a tool that reuses the same collection, validation, and query foundation while maintaining service-specific behavioral definitions.

## Goals
Collect and analyze with event/property schemas configured independently per project, report workflow completion and errors consistently, and protect privacy by not including sensitive information.

## Users
The first users are the people responsible for developing and operating multiple Rodisoft services. So that it can be reused for external services in the future, it is not tied to a specific product or private internal package.

## Example Scenarios
Sign-up, file conversion, confirmed payment success, calculation execution. These scenarios are semantic examples only and not a wire contract, and they do not handle sensitive inputs such as email, files, order IDs, or amounts. Payment and sign-up success are emitted only from confirmed sources, and button clicks are not treated as success.

## Approach
The SDK provides generic manual event hooks and has no calculator engine dependency or implicit automatic DOM collection. Each service defines meaningful names and integrations in its own repository. The event set is not six global events but a closed set of per-project registered schemas.

## Pilot
Sembom is the first pilot. A different type of service will be applied as the second pilot to confirm generality. The v0.1 contract maintains aggregates for 90 days, receipts for 48 hours, and attempt status for 72 hours, and does not store raw text. The operational domain, authentication provider, and IP protection policy are to be decided before activation. Apache-2.0 has been adopted; public distribution scope, release method, and npm publication remain separate work.

Usefulness is confirmed by the number and rate of completions of workflows registered per service, error types, and changes in actions that use the results. Display counts next to rates, and do not merge different completion definitions into the same metric. There are no measurement results yet. Scope and aggregation criteria follow the [product specification](./02-spec.md).
