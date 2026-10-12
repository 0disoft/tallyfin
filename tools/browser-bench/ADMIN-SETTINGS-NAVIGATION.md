# Settings navigation verification

Requires Node 24+ and the existing [Playwright setup](ADMIN-LOGIN.md).
This opt-in command does not install a browser or add ordinary CI launches.

```text
npm run verify:admin-settings-navigation -- --channel chromium
```

`--channel` accepts chromium/chrome/msedge. `--help` starts no services.
The command uses the actual admin UI/client, an ephemeral signed login and a
new Miniflare D1. It performs no remote requests or existing-profile writes.

Add `--check-unload` to verify native browser exit warnings too:

```text
npm run verify:admin-settings-navigation -- --channel chromium --check-unload
```

It dismisses actual `beforeunload` dialogs on settings-only edits, schema-only
edits, a reload with hidden drafts and a tab close with hidden drafts. Inputs
and the open tab must survive cancellation. A clean reload after disconnect
must not warn. A reload observation timeout is accepted only after the native
dialog was actually observed and dismissed; a synthetic event alone is not
proof. The report requires exactly four warnings. This does not test restoring
drafts after an accepted reload, forced exit or browser crash.

It edits project settings and a schema label, navigates to event analysis and
back, and verifies both drafts survive without an API write. Hidden controls
must not be visible. Return navigation must refresh permissions and offer the
existing explicit draft-comparison choices, not save automatically.

The fixture revokes the owner grant while analysis is visible. Returning must
retain both drafts but lock them under the current reader role. Project switching
must dispose the old drafts and returning to that project must show server data.
Disconnect from analysis must remove the hidden workspace too, with empty
local/session storage and cookies. This does not cover reload/closed-tab recovery,
multi-project draft storage, all forms, mobile accessibility or remote auth/D1.

The report `.tmp/admin-settings-navigation-*/report.json` contains fixed flags and
counts, not tokens or draft values. Failures preserve a fixed stage/code/counts
and a synthetic screenshot in that ignored directory. A 90-second watchdog closes
the browser; final cleanup closes browser, Vite and Miniflare. No server mutation
should occur: the report requires `apiWrites=0` and checks the project's original
name directly in D1. See [VALIDATION.md](../../VALIDATION.md) for observed evidence.
