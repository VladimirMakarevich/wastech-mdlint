---
name: "wastech-mdlint-impact"
description: "Compute the blast radius of changing a Markdown file with wastech-mdlint: resolve the target, run the CLI impact command (or the MCP impact-analysis tool when available), then report which files are affected directly and transitively, in what reading order, and what a cycle excluded. Use when the user wants to scope the impact of a change before editing, or asks what depends on a document."
license: "MIT"
compatibility: "Version-coupled to @wastech-mdlint/cli: use the CLI release carrying the same version tag as this skill (both ship from one P9 single-tag release; do not mix tags)."
metadata:
  homepage: "https://github.com/VladimirMakarevich/wastech-mdlint"
  source: "https://github.com/VladimirMakarevich/wastech-mdlint"
---

# Scope the impact of a Markdown change

This skill reports the **blast radius** of changing one Markdown file: which other
documents reference it directly, which are affected transitively, the order to read
the affected set in, and which nodes a cycle dropped from that order. It is a thin
policy layer over wastech-mdlint's impact engine — it does **not** re-traverse the
graph itself. The engine is reachable two ways, and this skill prefers the MCP tool
when the host exposes it and falls back to the CLI otherwise; both run the same core
classification, so the results are equivalent apart from the field-shape differences
documented in step 3.

Run the steps in order.

## 1. Verify setup

This skill assumes wastech-mdlint is already installed and configured. Confirm a
`wastech-mdlint.config.json` exists: start from the working directory and walk up its
ancestors (a nested `docs/` or `packages/foo/` can carry its own config, and the impact
engine resolves the config by the same walk-up). If none exists, stop and point the user
at the `wastech-mdlint-init` skill to bootstrap first — do not hand-write a config here.

Run every command below from the directory that owns the config you found, so the
corpus the graph is built from is the project you mean to analyze.

If you are using the CLI path (step 3), invoke it through the repository's package
manager — there is no reliable bare `wastech-mdlint` binary on `PATH`, and `npx` is
npm-specific. Pick the form matching the lockfile in the config's directory
(`bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn,
`package-lock.json` → npm):

- npm: `npx wastech-mdlint <args>`
- pnpm: `pnpm exec wastech-mdlint <args>`
- yarn: `yarn wastech-mdlint <args>`
- bun: `bunx wastech-mdlint <args>`

The examples below use the npm form; substitute your package manager's form throughout.
If the config's directory has no lockfile, the mapping has nothing to key on — ask the
user which package manager should run the CLI rather than guessing.

**Recommend, do not require, the reference and grouping rules.** The ContextGraph that
impact reads is built from _resolved_ links, image targets, and imports (plus ID-reference
edges, but only when the config sets `settings.idRef`), and that graph is constructed
unconditionally — impact does **not** depend on any rule being enabled. But two rule families make the results more trustworthy, so recommend the
user has them on "for meaningful results":

- **REF-001 / REF-002** keep relative links and anchors resolving, so the edges the graph
  builds match author intent instead of quietly dropping broken references out of the
  blast radius.
- **GRP-001** (cycles) is what explains nodes landing in `excluded`: a cycle in the
  affected set cannot be linearized, so those nodes are dropped from the topological
  reading order. If the user has GRP-001 enabled, a non-empty `excluded` list is already a
  known, flagged condition rather than a surprise.

Frame this as a recommendation. Never tell the user impact _requires_ these rules.

## 2. Resolve the target

The impact engine takes a **repository-relative POSIX file path**, not an ID. Passing a
target that is not a file in the corpus fails with `TARGET_NOT_FOUND` (CLI exit code 2).

- **If the user gives a file path**, normalize it to repository-relative POSIX (`/`
  separators) and use it directly.
- **If the user gives an ID, anchor, or heading** (e.g. `REQ-014`, a slug, a section
  title), resolve it to its containing file first, using the same MCP-preferred /
  CLI-fallback choice as step 3:
  - **Preferred — MCP `context-slice` tool** when the host exposes it. Input
    `{ query, depth?, configPath?, cwd? }`; it returns the same
    `{ query, matchKind, starts, files, visited }` shape the CLI JSON does.
  - **Fallback — CLI** `npx wastech-mdlint slice <query> --format json`.

  Both surfaces do exact (never fuzzy) resolution of the query against file paths,
  heading/anchor slugs, and defined IDs, and both report `matchKind` and `starts`
  identically. Read the resolved target from the `starts` array, **not** `files`:
  `files` is the whole depth-bounded slice (the query's start plus its neighbors), so
  it would drive `impact` on the wrong file. `starts` holds only the file(s) the query
  itself resolved to.
  - A `"matchKind": null` result means nothing matched — stop and ask the user to
    clarify rather than guessing a file.
  - Exactly one entry in `starts`: use it as the impact target in step 3.
  - More than one entry in `starts` (an ID, anchor, or heading shared across files):
    the query is ambiguous — list them and ask the user which file they mean rather
    than picking one.

  Note that **ID queries only resolve when the repository config sets `settings.idRef`**
  — without it the ID index is empty and an ID query will not match (fall back to asking
  for a file path or an anchor/heading). Anchor, heading, and path queries do not depend
  on `idRef`.

## 3. Run the impact engine

Prefer the MCP tool when the host exposes it (honest host semantics); otherwise use the
CLI.

- **Preferred — MCP `impact-analysis` tool.** Input `{ file, configPath?, cwd? }`.
  Returns structured output shaped `{ file, directlyAffected, transitivelyAffected,
readingOrder, excluded }`.
- **Fallback — CLI.** `npx wastech-mdlint impact <file> --format json`.

**The two surfaces do not return byte-identical JSON — state the difference honestly and
read the fields that actually exist:**

| Field                  | CLI JSON                                    | MCP output      |
| ---------------------- | ------------------------------------------- | --------------- |
| changed file           | `changedFile` (string)                      | `file` (string) |
| `directlyAffected`     | `{ path, references }[]`                    | same            |
| `transitivelyAffected` | `{ path, depth, via }[]`                    | same            |
| `readingOrder`         | `string[]`                                  | same            |
| `excluded`             | `string[]`                                  | same            |
| `lint`                 | present (findings on the affected subgraph) | **absent**      |

So: the changed file is under `changedFile` on the CLI and `file` on MCP; and the CLI
adds a `lint` field the MCP tool does not have. There is **no `hubs` field** on either
surface — do not report one; if the user wants hub context, that needs a separate `graph`
call (step 4). Do not reference any field not in this table.

## 4. Present the findings

Report the blast radius from the fields above. All paths are repository-relative POSIX
and the array fields are deterministically ordered, so present them as returned.

- **Directly affected** — from `directlyAffected`, each `{ path, references }`. These are
  the documents that reference the changed file directly; surface the `references` count
  so the user sees how tightly coupled each one is.
- **Transitively affected** — from `transitivelyAffected`, each `{ path, depth, via }`.
  Group or sort your presentation by `depth` and name the `via` predecessor so the user
  can see the dependency chain that pulls each document in.
- **Reading order** — from `readingOrder` (a `string[]`). This is a **topological** order
  over the affected subgraph, not alphabetical: predecessors come before successors, where
  the graph edges run `referrer → referenced`. For impact that means the **referrers /
  dependents appear before the file they depend on** — the changed file, being the thing
  everything else references, typically comes **last**. Present it in the order given —
  **do not re-sort it**, and do not describe it as "dependencies first."
- **Excluded** — from `excluded` (a `string[]`). These are affected nodes a cycle dropped
  from the reading order (see GRP-001 in step 1). Call them out explicitly: they are still
  in the blast radius, they just could not be linearized. A non-empty `excluded` list is a
  signal the user may have a dependency cycle worth breaking.
- **Lint (CLI path only)** — when you used the CLI, the `lint` field carries the findings
  on the affected subgraph. Surface it as extra signal: existing problems in the blast
  radius the change may interact with. The MCP tool has no `lint` field, so on that path
  simply note that lint findings are not part of the impact result.

If the user wants to know which documents are hubs (high fan-in/fan-out) rather than just
what this one file touches, that is a separate query, since impact has no hub field. On
the CLI use `npx wastech-mdlint graph` (the default human render; the other formats are
`--format json`, `--format mermaid` for a visual, and `--format dot`) — there is no
`summary` CLI format. On the MCP path use the `context-graph` tool with
`{ format: "summary" }` for the derived summary shape.

## Next steps to mention

Point the user at the companion skills as follow-ups: `wastech-mdlint-fix` to resolve any
findings this analysis surfaced (especially the `lint` findings from the CLI path), and
`wastech-mdlint-init` if step 1 turned up a setup gap. Keep these as pointers — this
skill's job ends at a reported blast radius.
