# Administrator Permission and In-Progress Save Verification

This requires Node 24 or later and the Playwright setup described in the
[sign-in verification guide](ADMIN-LOGIN.md). It does not install a browser automatically. This is
an opt-in command separate from the default checks and CI.

```powershell
npm run verify:admin-access -- --channel chromium
```

`--channel` accepts chromium, chrome, or msedge, and `--help` prints usage without running.

Verification uses a new local D1 database, a signed sign-in generated during the run, and an
isolated Vite cache. The test access profile contains 2 synthetic projects and a secondary owner so
last-owner protection remains in effect. Use the local operational tooling to switch
owner→reader→owner and verify the real server's 403 response, UI edit locking, draft preservation,
and explicit permission recovery. Even after restoring permission, revalidation and privacy review
are still required.

Both directions are checked: schema-validation denial locking project settings, and settings-save
denial locking the schema. Both drafts are preserved and recovered through a fresh permission
lookup and an explicit choice.

2 settings saves are committed on the server, then their responses are withheld. Switch projects or
disconnect, then release the responses and verify that the old results do not change the current
screen. Content already saved on the server must remain in the database. This diagnostic does not
verify a feature that rolls back a save.

A successful run records only fixed results and counts in `.tmp/admin-access-*/report.json` and on
standard output. Tokens, account identifiers, source URLs, and drafts are excluded. A failure leaves
a fixed stage and code plus synthetic screen images in the local folder and exits with code 1.
Temporary material is excluded from Git. A 90-second limit applies, and the browser, Vite, and
Miniflare are cleaned up on exit. No production settings, database, sign-in provider, or remote
environment is used. Follow [VALIDATION.md](../../VALIDATION.md) for execution evidence.
