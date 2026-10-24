# Contract Check Tools

This is a development-only package, separate from production applications and SDKs. Run it from the
repository root.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

Redocly validates OpenAPI syntax and references, Ajv validates JSON examples and rejected inputs,
and the DBML parser validates logical structure. Additional checks inspect only registered
definitions, cardinality, date boundaries, totals, and documentation links in examples. They do not
run the collection state machine, database transactions, production authentication, or actual
migrations. Development dependencies are managed by major-version ranges and the lockfile, and are
not included in the collection SDK.
