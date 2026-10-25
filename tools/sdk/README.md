# SDK Package Verification

```powershell
npm run verify:sdk-packages
```

This uses Node 24 or later and the repository's existing development dependencies. It is not part
of the default checks or CI. Run it explicitly before publication to verify the actual tarball
consumption path.

1. Place stale regression files in the browser and server `dist` directories, then run the existing
   workspace build. The build verifies that each SDK's real path is inside the repository and
   cleans only `dist`.
2. Use `npm pack --offline --ignore-scripts` to create two local tarballs under
   `.tmp/sdk-packages/run-*`. Check that their contents exactly match the current published file
   list, preventing source, tests, configuration, or old declaration files from being included.
   Both tarballs must include `LICENSE` and `NOTICE` as exact copies of the canonical root
   [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
3. Install only those tarballs into a new temporary npm project outside the workspace. The install
   is offline, scripts are disabled, no lockfile is created, and audit and fund are disabled. Verify
   that the actual install path is not a workspace symlink.
4. In that project, compile and run three ESM entry points (`@tallyfin/browser`,
   `@tallyfin/browser/funnels`, and `@tallyfin/server`) and their declaration files with TypeScript
   NodeNext and Node. Browser creates and disposes in a disabled state, and server creates only one
   event. Verify that no network or token callback occurs. Actual transport and browser behavior are
   tested separately.

On success, `report.json` and the `tallyfin.sdk-packages/v1` report on stdout record tarball names,
sizes, SHA-256 values, file lists, and type and execution results. A failure exits with code 1 and
prints only a fixed phase and code. The command also supports `--help` without a target. The
temporary consumer project is removed after success or failure; tarballs and reports remain in a
git-excluded path. Child commands have a 45-second limit, and the entire run has a 120-second limit.

If the parent `npm run` passes `.npmrc` allow-scripts through an environment variable, a recent
npm can mistake it for a project-install CLI allow policy and reject it with `EALLOWSCRIPTS`.
Remove only that re-passed value from the child environment so the original `.npmrc` policy is read.
Do not modify user configuration, and keep `--ignore-scripts` on pack and install.

This command does not query a registry, sign in, publish, add dependencies, or change versions. Both
SDKs remain `private: true` at `0.0.0`. First-party code and documentation in all Tallyfin packages
and SDKs use Apache-2.0; third-party code and fonts retain their original licenses and notices,
including the Inter and Noto Sans KR OFL notices. The operator must still establish public scope
and release method; actual npm publication is separate work. Follow [VALIDATION.md](../../VALIDATION.md) for verification records and
[workspace-boundaries.md](../../docs/monorepo/workspace-boundaries.md) for package boundaries.

## Commit-labelled distribution

```powershell
npm run sdk:bundle -- --out .tmp/sdk-distribution
```

This requires a clean committed checkout: tracked edits or untracked files abort before packaging, and an
existing output directory is rejected before the build. The command runs the existing
`verify:sdk-packages` flow unchanged and writes commit-suffixed browser and server tarballs,
`SHA256SUMS`, and `manifest.json` into a new directory. The manifest records `source.commit`,
`source.tree`, `source.dirty: false`, artifact `sha256` and `bytes`, plus `published: false`.
It copies four required files with fixed names: `tools/sdk/README.md` as `sdk-README.md`,
`docs/integrations/independent-sites.md` as `independent-sites.md`, `examples/independent-site/README.md`
as `site-README.md`, and `examples/independent-site/site.example.json` unchanged. Their hashes are listed
in the manifest. The source identity is checked again after those copies and immediately before
`manifest.json`, which is written last and marks completion; a failed run keeps partial files for
inspection. The command does not publish, change versions, or accept credentials. Use `--help` for the
usage summary.
