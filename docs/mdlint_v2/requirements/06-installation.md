# v2 Requirements — 06 · Installation & Distribution

> **Status:** Locked 2026-06-21 · Part of the [v2 roadmap](../index.md)
> (Phases **P6** init, **P9** release).
>
> Locked v2 requirement; authoritative where the plan is otherwise ambiguous.

## Decisions

| # | Improvement | Status | Notes |
| --- | --- | --- | --- |
| **I1** | Drop `postinstall` auto-config → explicit `init` only | ✅ Accepted | Remove `scripts/install-default-config.mjs`; no file writes on install. |
| **I2** | Make CLI `init` smart by default (merge the two flows) | ✅ Accepted | Cluster detection, file sampling, rule-category suggestion, package-manager detection; `--yes` for CI. Skill orchestrates on top. |
| **I3** | `init` wires the local `$schema` + generates project schema | ✅ Accepted | Ties to [C9](01-configuration.md). |
| **I4** | One version tag publishes core+cli+mcp and tags skills | ✅ Accepted | the vendor-neutral skill distribution decision version coupling; changesets / release workflow. |
| **I5** | Per-package supply chain | ✅ Accepted | npm provenance on all packages, `engines.node`, `files` allowlist, lockfile CI. |
| **I6** | First-class GitHub Action / reusable CI workflow | ✅ Accepted | Publishable Action; `init` can drop `.github/workflows/wastech-mdlint.yml`. |
| **I7** | Documented `gh skill install … --pin` + compatibility frontmatter | ✅ Accepted | Reproducible, version-coupled skill install. |
| **I8** | legacy-to-v2 config migration (guide / `migrate` command) | ⛔ Not needed | **Greenfield** — no prior users; reinforces [D2](../index.md) clean replace. |

## Detail & rationale

- **I1 — no `postinstall`.** The current implementation silently writes a default config on install
  (`install-default-config.mjs`). A `postinstall` that writes files is an anti-pattern: it
  runs on transitive/CI installs and can clobber. v2 removes it; configuration is created
  only by the explicit `init` command.

- **I2 — smart CLI `init`.** The reference splits a *dumb* manual `init` (no scanning,
  hardcoded zero-config rules) from a *smart* skill-driven init (scans, infers). That makes
  the CLI alone produce a weak config and pushes the good experience onto the AI host. v2
  moves the smart inference into the CLI `init` itself — detect doc clusters, sample files,
  suggest rule categories, detect the package manager — with a non-interactive `--yes` mode
  for CI. The `wastech-mdlint-init` skill then orchestrates and layers GH Actions + README
  on top (S7/S8).

- **I3 — local schema in `init`.** `init` sets `$schema` to the local path and, when custom
  rules exist, generates the project-local schema ([C9](01-configuration.md)). No remote URL.

- **I4 — single-tag release.** Per [vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md),
  one `vX.Y.Z` tag publishes `@wastech-mdlint/{core,cli,mcp-server}` and tags the skills
  together. Prevents version skew between CLI/MCP and the skills that target the CLI surface.

- **I5 — supply chain.** Extend the current implementation's npm provenance to every package; pin `engines.node`
  (`>=24.17.0 <25`), set per-package `files` allowlists, and run lockfile-based CI for
  reproducible builds.

- **I6 — GitHub Action.** The init skill already offers a CI workflow; v2 makes it
  first-class as a publishable/reusable Action — a major "production" adoption lever — and
  `init` can optionally drop the workflow file.

- **I7 — skill install.** Document
  `gh skill install VladimirMakarevich/wastech-mdlint <skill> --pin vX.Y.Z`; the skill
  `compatibility` frontmatter matches the CLI version, coupled to I4.

## Not needed

- **I8 — migration.** The project is **greenfield** (no released users; `v0.0.0`). No
  migration guide or `migrate` command is built; the repo's own config is simply rewritten
  in the new shape. Confirms [D2](../index.md).
