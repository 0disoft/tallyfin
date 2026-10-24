# Contributing

Status: These are the procedures for code, test, and documentation changes in the local implementation. The license and CLA are undecided, and the handling of rights for external contributions and the distribution of public packages are not settled.

## Types of contributions
- Documentation: clear and concise, without repetitive template language.
- Design: clearly distinguish plans from implementation, verification, and production state.
- Code: respect the target package's ownership boundaries and verify only the changed scope. Check test and build commands in the root and target package `package.json` files.

## Code changes

- Keep API requests and responses aligned with [OpenAPI](api/openapi.yaml), the database structure aligned with [DBML](db/schema.dbml), and product scope aligned with the [specification](docs/product/02-spec.md).
- For SDK changes, run the relevant SDK tests and build plus `npm run check:browser-size`; for administrator changes, run `npm run check:admin`; and for storage or collection changes, run the relevant tests and type checks. You may skip the size check when the SDK did not change.
- Record executed checks, skipped checks and reasons, and production scope that remains unverified in the [validation record](VALIDATION.md). Do not assume that lint exists or that CI passed.
- Commit small logical units and exclude unrelated changes. Version bumps, pushes, publications, and deployments are decided explicitly for the task at hand.

## Review criteria
- Privacy: do not use data outside the allowlist, persistent identifiers, cookies, or storage ([ADR 0003](./docs/adr/0003-minimal-privacy-preserving-events.md)).
- Performance: no synchronous collection I/O and no waiting for rendering or calculations.
- API scope: settle the actual delivery contract and database contract before implementation ([ADR 0002](./docs/adr/0002-contract-source-of-truth.md)).

## Documentation
Relative links in documentation point to real files. Do not record unimplemented features or checks that were not run as completed.

## License
The license and CLA are undecided. Do not assume rights before they are settled.
