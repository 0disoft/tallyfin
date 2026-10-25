# Independent Site Example

`site.example.json` is a browser-only fixture for a site in its own repository; hosts use `.invalid`, and
nothing here registers remotely or starts collecting.

```sh
npm run site:prepare -- --file examples/independent-site/site.example.json --out .tmp/site-example
```

Run it inside the Tallyfin checkout. It writes `registry.json`, `project-create.json`,
`schema-draft.json`, `schema-publication.review.json`, `browser-config.json`,
`template-config.json`, `analytics.ts`, and `requests.json` into a new directory. Publication stays
`privacyReviewed: false` and the template stays `registrationVerified: false`. The delivery ZIP can carry
the same `site-example/` folder.

From the extracted ZIP, verify everything before copying, then install the browser tarball by its exact
manifest name:

```powershell
$m = Get-Content manifest.json | ConvertFrom-Json
foreach ($i in $m.artifacts + $m.guides) {
  if ((Get-FileHash $i.filename -Algorithm SHA256).Hash -ne $i.sha256) { throw $i.filename }
}
$browser = $m.artifacts | Where-Object name -eq '@tallyfin/browser'
New-Item -ItemType Directory -Force "vendor/tallyfin/$($m.source.commit)" | Out-Null
Copy-Item $browser.filename "vendor/tallyfin/$($m.source.commit)/"
npm install --offline --ignore-scripts --save-exact "./vendor/tallyfin/$($m.source.commit)/$($browser.filename)"
```

On POSIX, run `sha256sum -c SHA256SUMS` at the ZIP root, then copy the same manifest `filename` values.

Copy `analytics.ts` from `site-example/` into the site:

```ts
import { setAnalyticsConsent, trackPage, trackLanguageChange, startTool, flushAnalytics } from './analytics';

setAnalyticsConsent(true);            // creates the only client
trackPage('home', 'ko');              // once per completed navigation
trackLanguageChange('en');            // after the locale change takes effect

const task = startTool('calculator', 'en');
if (task) {
  try {
    await runCalculator();
    task.succeed();
  } catch (error) {
    if ((error as Error).name === 'AbortError') task.cancel();
    else task.fail({ failure_reason: classifyToolFailure(error) });
  }
}
flushAnalytics();                     // schedules only; no delivery guarantee

setAnalyticsConsent(false);           // drops queued/in-flight events; old handles fail
setAnalyticsConsent(true);            // fresh client after a later grant
```

`classifyToolFailure` returns exactly `validation`, `unsupported`, `dependency`, `timeout`, or
`other`. Send only reviewed `locale` and `tool` values; unknown page, tool, or locale values are rejected.
Retries reuse the same ID, time, and body; receipts give at-most-once aggregation for the same retained ID,
and delivery can still be lost. Server tarballs and publisher secrets never belong in browser code.

