# Administrator Prototype Record

The runnable administrator source has moved to [apps/admin](../../apps/admin/README.md). This folder
keeps only the [initial design QA](./design-qa.md) record. The independent installation and run
commands from the previous location are not used.

From the repository root, use `npm ci --ignore-scripts`, `npm run dev:admin`, and
`npm run check:admin`. `npm run dev -- --local --state-dir ...` also runs the new administrator
application alongside the collector. Production authentication and remote deployment verification
remain future work.
