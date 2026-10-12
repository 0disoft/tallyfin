# Settings response recovery verification

Requires Node 24+ and the existing [Playwright setup](ADMIN-LOGIN.md).
This opt-in command does not install a browser or run in ordinary CI.

```text
npm run verify:admin-settings-recovery -- --channel chromium
```

`--channel` accepts chromium/chrome/msedge; `--help` prints usage without
starting Vite, Miniflare or a browser. Each execution uses a new disposable
D1 store, runtime-generated signing keys and an isolated Vite cache. It uses
the actual admin component, API client, signed collector requests and D1 writes.
No deployed identity provider, credentials or existing database is used.

The scenarios distinguish:

- A synthetic HTTP 503 before forwarding the write: preserve the input and
  unchanged D1 state, then explicitly compare, retain the draft and save once.
- A successful authenticated D1 write whose HTTP response is deliberately
  dropped: lock the draft, read back its committed value and adopt it without
  another PATCH.
- A committed response held beyond the client's unmodified 15-second deadline:
  read back and retain the committed draft, then release the late response and
  verify no state replacement or additional PATCH. No fake browser clock is used.
- A committed write followed by owner-to-reader revocation before readback:
  the comparison remains usable but edits stay locked. Restore owner through
  the fixture, explicitly refresh, and verify only that fresh read restores editing.

Disconnect must remove settings controls and leave local/session storage and
cookies empty. Five browser PATCH attempts must correspond to one intercepted
pre-commit failure and exactly four forwarded writes; readback/adoption/no-op
save do not create writes. This does not prove concurrent-operator isolation,
power-loss durability, remote D1 behavior or complete authentication coverage.

Reports are `.tmp/admin-settings-recovery-*/report.json` and stdout, containing
fixed verification flags and counts, not tokens or draft values. Failure records
only a fixed stage/code/counts and a synthetic screenshot in that ignored folder.
The 90-second watchdog releases any held response and closes the browser;
commit/delivery barriers have separate bounded waits. Normal/failing exits clean
up browser, Vite and Miniflare. This command does not undo successful server writes.

The shared fixture permits lost PATCH responses only for the two access-profile
projects. Its existing onboarding POST/PUT and access post-commit wait paths
remain separate. [VALIDATION.md](../../VALIDATION.md) records observed results.
