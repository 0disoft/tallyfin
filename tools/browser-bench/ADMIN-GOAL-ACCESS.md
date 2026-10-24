# Goal and Funnel Read Permission Verification

```powershell
npm run verify:admin-goal-access -- --channel chromium
```

This requires Node 24 or later and the Playwright environment described in the
[sign-in verification guide](ADMIN-LOGIN.md). `--channel` accepts chromium, chrome, or msedge, and
`--help` prints guidance without running. It does not install a browser automatically. This is an
opt-in command that is not connected to the default checks or CI.

It uses only a new Miniflare D1, an isolated Vite cache, and an RS256 signing key generated during
the run. It does not connect to production settings, OIDC, or a remote database. A test-only goals
profile registers a workflow, a two-stage funnel, 2 synthetic projects, and a secondary owner. It
prepares 16 events for the current and previous periods through Core verification and a D1 commit.
Specifying past receive timestamps is part of fixture setup; it is not verification that real
browser collection can send events from the past.

Open the goal in the UI and select a breakdown and period comparison. Immediately before each of the
following 6 requests, revoke the actual D1 grant with the operational tool and pass through the 403
returned by the signed API unchanged.

- Workflow current-period property query
- Workflow previous-period property query
- Funnel current-period total query
- Funnel current-period property query
- Funnel previous-period total query
- Funnel previous-period property query

After each denial, the previous table, breakdown, comparison, and CSV must be removed or disabled.
After regranting, refresh the UI and recover through the following path. In a normal funnel
comparison, confirm the current loan and previous timer rows exactly, and verify that the actually
downloaded CSV contains 1 start and completion per period and a 1/0 and 0/1 comparison for each
property. Also confirm 4 workflow starts and 4 funnel starts across the full D1 database.

The seventh request receives a real 403, then its response is withheld. Switch to another project and
release the withheld response, then check that the new screen's permissions and CSV remain. The new
project's real CSV must not contain the previous project ID. After disconnecting, analytics and export
elements must also be absent.

A successful run records fixed results and counts in `.tmp/admin-goal-access-*/report.json` and on
standard output. Synthetic screenshots of the current and comparison screens are placed in the same
Git-excluded folder. A failure records the stage, scenarios passed, observed denials, and screenshots,
then exits with code 1. Tokens, raw errors, and input drafts are not recorded. A 60-second limit
applies, with browser, Vite, and Miniflare cleanup.

This is evidence for the local Chromium, signed API, and D1 path. It does not extend to every API,
organization, and role combination, a real provider, production deployment, mobile, or other
browsers. Put execution results in the [validation record](../../VALIDATION.md).
