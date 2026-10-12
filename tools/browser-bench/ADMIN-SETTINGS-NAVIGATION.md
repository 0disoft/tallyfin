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

While drafts are hidden, it cancels native confirmation for project switching
and disconnect, requiring the selected project, both drafts and session to stay.
It then accepts project switching and verifies disposal. Clean switching and
disconnect must proceed without a dialog. With `--check-unload`, settings-only
and schema-only edits each also require a cancelable project-switch confirmation.
The separate `verify:admin-access` accepts both confirmations while real settings
commits await a held response and still checks late-response isolation.

Add `--check-created-exit` to grant creation authority only to this ephemeral
access fixture. It creates one additional project while existing drafts are
hidden, cancels automatic opening and one explicit reopen, then accepts reopening.
The old project/drafts and new option/receipt must survive both cancellations.
The new D1 project row must exist exactly once and `apiWrites` must remain one
after the accepted reopen. This flag can be combined with `--check-unload`.
It does not grant authority to an existing profile or real identity provider.

Add `--check-analysis-refresh` to hold one actual authenticated project-list GET
after reading local D1, then return a synthetic 503 instead of its response:

```text
npm run verify:admin-settings-navigation -- --channel chromium --check-analysis-refresh --check-unload --check-created-exit
```

While the GET is held and after its failure, hidden settings/schema and raw
grant/publisher drafts must remain mounted and unchanged. Disconnect must still
ask for disposal and cancellation must preserve the workspace. Entering settings
during the failed list must keep its controls hidden. Explicit retry must restore
the same selected project and drafts after current settings/schema reads and
the existing comparison choices. Raw authority drafts must also survive and are
cleared by the test before the ordinary navigation checks. No settings or
authority write is permitted. This flag adds no recurring collector or CI run.
The directly intercepted GET is counted in `interceptedProjectReads`, separately
from fixture `apiReads`; the combined read count is their sum. The watchdog and
final cleanup release the held response before closing services. This tests list
read failure, not a successful response removing the selected project.

The fixture revokes the owner grant while analysis is visible. Returning must
retain both drafts but lock them under the current reader role. Project switching
must dispose the old drafts and returning to that project must show server data.
Disconnect from analysis must remove the hidden workspace too, with empty
local/session storage and cookies. This does not cover reload/closed-tab recovery,
multi-project draft storage, all forms, mobile accessibility or remote auth/D1.

The report `.tmp/admin-settings-navigation-*/report.json` contains fixed flags and
counts, not tokens or draft values. Failures preserve a fixed stage/code/counts
and a synthetic screenshot in that ignored directory. A 90-second watchdog closes
the browser; final cleanup closes browser, Vite and Miniflare. The default report
requires `apiWrites=0`; `--check-created-exit` requires exactly one creation write.
Both check the original project's unchanged name directly in D1.
See [VALIDATION.md](../../VALIDATION.md) for observed evidence.
