# Context compiler — `compile`

> [Guide index](README.md) · [CLI reference](cli.md#compile) · [Configuration](configuration.md)

`compile` generates a **deterministic** `SKILL.md` — a project-specific agent skill — from the [context graph](context-graph.md), the active rule descriptions, and the `compile` config. It lets an AI host load a compact, accurate description of _this_ repository's docs structure and conventions.

## Usage

```bash
wastech-mdlint compile                 # write SKILL.md to the resolved outdir
wastech-mdlint compile --dry-run       # print it to stdout instead of writing
wastech-mdlint compile --outdir build/skill
wastech-mdlint compile --cwd packages/docs
```

- Output path precedence: `--outdir` → `config.compile.outdir` → `.claude/skills/wastech-mdlint/`. The file is always named `SKILL.md`.
- **The default outdir is inside the default lint corpus.** Nothing is excluded merely for starting with a dot, so a later `lint` reads the `SKILL.md` this command generated — a parse and no findings on the zero-config path, and governed by your `include` once you have a config. Retarget `outdir` if you would rather it stay out of scope; see [what is excluded before you write anything](configuration.md#what-is-excluded-before-you-write-anything).
- Unlike other commands, `compile` takes `--cwd` (not `[path]`), and resolves a relative `--outdir` against it. A relative `--config` resolves against `--cwd` too — not as a compile-specific rule, but because every command resolves `--config` against the directory it analyzes (see [CLI reference](cli.md#lint-default)).
- An `--outdir` that resolves outside `--cwd` is reported by its **absolute** path, in the success line and in a write failure alike; one inside is reported repository-relative with `/` separators, as everywhere else.
- Requires a `compile` section in config; a missing one exits `2` with guidance, not a stack trace.

## What goes into `SKILL.md`

The compiler analyzes the graph (classifying nodes as entry/hub/leaf/isolated/bridge), extracts a document profile (outline, table schemas, detected ID patterns, references in/out), describes the active rules, and synthesizes a skill document. Output is **byte-deterministic**: sorted, POSIX paths, a content hash, no timestamps — so re-running on the same inputs produces identical bytes.

### The dependency section is bounded, and says so

A skill file is loaded into an agent's context **whole**, so `Document Dependencies` is capped rather than allowed to grow with the corpus. Two fixed bounds apply, and the section states both in the artifact itself:

- At most **10** references per document per direction. Each bullet carries the _full_ count, so `- from (124, showing 10):` is unambiguous about what you are not seeing. The unit is **edges, not distinct documents**: the graph keeps one edge per reference written in the source (a plain link and an anchored one to the same file are two edges), so one referencing document can occupy several of the ten slots and appear more than once in the list. This is why the count in the bullet can be far larger than the number of documents behind it, and why `wastech-mdlint impact <file>` — which reports the referencing _files_ — is the better tool for "who depends on this".
- At most **25** documents get a `### References` entry. The ranking — total references first, then path — decides _which_ 25 are listed, not where they appear: the entries themselves are rendered in path order, as they always were. When the bound engages, the artifact names how many documents were omitted.

Both bounds are fixed rather than corpus-relative: they do not engage below the bound, and the rule the artifact states means the same thing in every repository instead of varying with corpus size. A cycle path is elided past eight entries for the same reason.

Two things that fixed bounds do **not** promise, both worth knowing before you diff a committed `SKILL.md`:

- **This release re-renders every artifact once.** The `Refs (in/out)` column, the always-on `Bounded summary:` paragraph, and one reference per line instead of a comma-joined list change the bytes and the content hash of every generated `SKILL.md`, whatever the corpus size. Regenerate and commit the result; after that, the same inputs produce the same bytes again.
- **The document bound is a top-25 selection, so it is not local.** Adding a well-referenced document elsewhere in the corpus can push an existing one out of the list — dropping its `### References` entry and changing the omitted count — even though nothing about that document changed.

**The full graph is not lost** — `wastech-mdlint graph --format json` has the complete edge list and `wastech-mdlint impact <file>` has one document's, which is what the disclosure paragraph points at.

`Reading Order` and the excluded-from-reading-order list are **not** capped: a document silently missing from the reading order is the exact dishonesty that block exists to prevent.

## Config

```jsonc
"compile": {
  "outdir": ".claude/skills/wastech-mdlint",
  "skill": {
    "name": "my-project-context",              // required, non-empty
    "description": "Docs context for my project" // required, non-empty
  },
  "sections": {                 // gate which SKILL.md sections render (all default true)
    "architecture": true,
    "rules": true,
    "dependencies": true,
    "workflow": true
  },
  "commandPreset": "generic",   // "claude" | "generic" | "none" — wording of the deps block
  "hubMinInDegree": 3           // in-degree threshold to classify a document as a hub (default 3)
}
```

- `skill.name` / `skill.description` are required.
- `sections.*` toggle the four generated sections.
- `commandPreset` selects the phrasing of the "Working with dependencies" block.
- `hubMinInDegree` tunes hub classification. **The `Role` column is coarse at scale**, and raising this does not change that: on a 139-document corpus the five roles land 73 `hub` / 46 `isolated` / 11 `entry` / 5 `bridge` / 4 `leaf`, so two buckets hold 86% and in practice read as "has edges" versus "has no edges". `isolated` is a true fact about the corpus that no threshold touches, and an absolute in-degree threshold cannot be scale-free — 3 is meaningful at 10 documents and noise at 1000. Read the `Refs (in/out)` column beside it for the degrees the bucket rounds off; it is what separates a 3-reference hub from a 124-reference one. Recorded in the [accepted-behaviors register](../mdlint_v2/accepted-behaviors.md).
- `hubMinInDegree` does **not** bound the dependency section — that is the fixed cap above, deliberately kept separate because this option governs role assignment.
- Unknown `compile.*` keys are rejected like any other unknown config key.

## Compile vs. static skills

`compile` produces a **generated, project-specific** skill. The three **hand-authored** skills (`-init`, `-fix`, `-impact`) are separate and shipped as-is — see [Skills](skills.md). Both share one frontmatter schema in core.

## Via MCP

The [`compile-context`](mcp-server.md) MCP tool produces the same deterministic output as this command (as two plain-text blocks). It also requires `config.compile`.
