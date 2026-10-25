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
