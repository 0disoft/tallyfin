# Repository Design Scaffold

- Status: Draft
- Scope: fullstack
- Repository Type: monorepo
- Addons: none

This repository contains an LLM-friendly design scaffold. It is not application source code.

## Source Files

- AGENTS.md: agent working rules
- CHECKLIST.md: checklist router
- VALIDATION.md: validation names and reporting requirements
- .agents/context-map.md: agent route map
- docs/: design, operations, architecture, and engineering standards

## Repository Shape Notes

- monorepo: This repository type owns workspace boundaries, package ownership, dependency policy, and change coordination.


## Repository Hygiene

.editorconfig, .gitattributes, and .gitignore are generated to keep line endings,
binary diffs, local files, build outputs, caches, and secret files under control.

## Scope Notes

Project-specific implementation choices remain UNDECIDED until the repository owner records them.
