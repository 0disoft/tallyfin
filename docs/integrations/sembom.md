# Sembom File Pilot Integration Example

Sembom is Tallyfin's first pilot, and this document is an example of a project-level registered schema, not part of the Tallyfin core. Do not pull Sembom-specific requirements into the core.

## Registered events

At implementation time, the plan is to register the following 6 events for the Sembom project. The repository example `examples/sembom/browser-schema.json` projects the same 6 events.

- tool_view: when a person views a tool screen
- input_start: when a person explicitly starts entering input
- calculation_success: when a calculation succeeds
- validation_error: when a validation error occurs
- result_copy: when copying a result succeeds
- feedback_submit: when feedback submission succeeds

These 6 names are only the registration example for the Sembom project; they are not global required Tallyfin events.

## Properties

tool, locale, mode, error, and field are optional property candidates, not core required fields. The v0.1 [registration example](../../api/examples/registry.json) uses only a small enum for tool and a fixed error enum for validation_error. The full tool list is registered separately within the 256-combination limit, and this example is not production configuration.

## Lifecycle and source boundaries

input_start creates a random attemptId and startedAt when the user first enters input for that tool visit, and the first subsequent calculation_success carries the same values. Automatic initial results are not counted as completion. Input validation errors are ordinary events and are not counted as task-ending failures. The goal in this example has no failure step, so failedAttempts=null. result_copy and feedback_submit are sent only when the action succeeds, and the server does not record the same business operation twice.

## Current example implementation
The integration example is in `examples/sembom/browser.ts` and `examples/sembom/browser-schema.json`. The schema matches the browser schema projected at build time from the v0.1 [registration example](../../api/examples/registry.json), and `npm run check:browser-size` verifies that they match. The example exposes `createSembomAnalytics(endpoint, enabled = false)` and is disabled by default, so the host must enable it explicitly before collection starts. It exposes view, startInput, validationError, resultCopied, feedbackSubmitted, flush, and destroy, and the host is responsible for linking succeed and fail on the work handle returned by startInput. This example exists only in the repository and has not been installed or activated in the actual Sembom repository, and there is no active data collection.

## Boundaries

Event and property names are defined in the Sembom repository, and the Tallyfin SDK does not hardcode the names. Registered schemas are versioned so changes do not mix with previous aggregates. The host adapter remains in the Sembom repository, and this document does not modify that repository. There is currently no active data collection.

For detailed schema rules, follow the product [02-spec.md](../product/02-spec.md), and for SDK behavior, the [browser SDK](../backend/browser-sdk.md).
