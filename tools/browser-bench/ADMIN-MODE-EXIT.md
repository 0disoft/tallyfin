# Demo API mode exit verification

Requires Node 24+ and the existing [Playwright setup](ADMIN-LOGIN.md).
This opt-in command installs no browser and adds no ordinary CI launch.

```text
npm run verify:admin-mode-exit -- --channel chromium
```

`--channel` accepts chromium/chrome/msedge. `--help` starts no services.
Add `--check-creation-draft` for the connection-wide project creation checks:

```text
npm run verify:admin-mode-exit -- --channel chromium --check-creation-draft
```

The command uses the actual `/demo` entry, App, API workspace and client with
a new Miniflare D1 and the existing ephemeral signed provider. It first logs in
at the ordinary entry, receives the test-only signed bearer in process memory,
then uses the real demo's manual connection form. It does not alter App props,
replace the bridge, bypass API authentication or use an existing user profile.
The bearer is never printed or put in reports, storage, cookies or trace files.
This does not test mode switching with a production OIDC session.

It edits settings and a schema label, then hides those editors through analysis
navigation. The same API mode button must not warn. Canceling the native Sample
confirmation must retain API mode, selection, drafts and connection. Returning
to settings must still offer the existing explicit comparison choices.

Accepting Sample must dispose the API editors. Returning to API must show a new
connection screen with an empty token input and no authorized project controls.
Leaving this clean screen must not warn. No server write is allowed; the original
project name is checked directly in D1. Local/session storage and cookies must
be empty. This is UI disposal evidence, not proof of zeroed heap memory or draft
recovery after accepted exit, all forms, all pending writes or other browsers.

With `--check-creation-draft`, the isolated grant permits creating a synthetic
project. A pristine form must close without a dialog; a dirty form must survive
close cancellation and be discarded only after approval. Project selection must
retain the form without warning. Canceling disconnect, Sample mode or native
reload must retain the input. The fixture then drops one actual creation
response after D1 commits. Canceling disconnect must retain the immutable
confirmation request. Explicit same-request confirmation sends a second POST
but must leave exactly one project row. Confirmed creation may open its project
without a false draft warning. The ordinary command still permits zero writes;
this option permits exactly these two POSTs and leaves the original project
name unchanged. It does not test an accepted exit while a write is pending.

The report `.tmp/admin-mode-exit-*/report.json` contains fixed flags and counts,
not credentials or draft values. Failures retain a fixed stage/code/counts and
a synthetic screenshot. A 90-second watchdog closes the browser; final cleanup
closes browser, Vite and Miniflare. Observed evidence is in
[VALIDATION.md](../../VALIDATION.md).
