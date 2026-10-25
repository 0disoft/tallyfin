# 0disoft.github.io pilot

The first service pilot uses the reviewed [registry](registry.json), project
`zerodi-site`, schema version 1 and the site's existing analytics consent.
The browser sends `page_view` with two bounded enum properties: page category
and interface language. It sends no full URL, query, title, article slug,
referrer, search text or visitor identifier in the event body. The registry
allows only `https://0disoft.github.io` and limits public ingestion.

The browser SDK is installed in the site from a local, licensed package archive;
npm publication is not required for this pilot. Events use the existing public
batch route through the administrator Worker and its private Collector binding.
No administrator token or auth cookie is needed for ingestion. Administrator
reads and publisher APIs retain their existing authentication requirements.

Consent withdrawal destroys the client, drops queued events and aborts pending
requests; already accepted aggregates remain. SPA navigations count once each,
including revisits, while initialization and the initial navigation share one
identity. Pilot evidence belongs in the repository's validation record; this
configuration alone is not proof of deployed collection or remote recovery.

## Action funnels (schema 2)

[Schema 2](registry-v2.json) extends the page-view pilot without changing schema
1. Keep version 1 active for open tabs and cached older site builds. Deploy the
new registry before the site begins sending version 2.

| Funnel | Ordered steps | Completion means |
| --- | --- | --- |
| `story_sharing` | `story_opened` → `share_copy_started` → `share_link_copied` | The clipboard helper reported successful copy, once per story navigation |
| `search_discovery` | `search_started` → `search_result_clicked` → `search_destination_opened` | A debounced search ran, a result was clicked in the same tab, and navigation completed to that path |

Each funnel uses a fresh random run ID held only in tab memory. The ID identifies
a task, not a person; it is never persisted in cookies or browser storage.
Properties remain the existing `section`/`locale` enums. Funnel breakdown is by
starting language, kept constant across that task. No text, URL, article identity
or clipboard contents enter the payload. A path is compared only in local memory
to match a destination and is never sent. Seven event types have at most 42
property combinations each; each funnel has six language groups.

Copy failure/cancellation never counts completion. A retry can finish the same
copy task without duplicating its attempted milestone. New searches rotate runs;
invalidated results cannot advance them. Failed or different navigation does not
finish the search funnel. Opening a new tab is not linked. Consent withdrawal
clears all contexts and invalidates late async callbacks. Reloads and new tabs
start fresh; missing milestones do not establish abandonment or a unique user.
This static-site pilot does not prove server-side business completion or that a
copied link was subsequently shared or visited.
