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

### Every section is bounded or says it is not

A skill file is loaded into an agent's context **whole**, so its byte budget is the product. Each section is therefore one of two kinds, and it tells you which in the artifact itself:

| Section | Kind | What it says |
| --- | --- | --- |
| `Document Architecture` | **Bounded** — at most 25 rows | `Bounded summary: at most 25 documents get a row here…` |
| `Document Dependencies` → `References` | **Bounded** — at most 25 documents, 10 references per direction | `Bounded summary: at most 10 references are listed per document per direction…` |
| `Document Dependencies` → `Reading Order` | **Complete** — one entry per document | `Complete: all N document(s) in the order are listed, so this section grows with the corpus.` |
| `Document Dependencies` → `Cycles` (the excluded list) | **Complete** — every excluded document | `Complete: every excluded document is listed.` |

So a reader can always tell whether a list is the whole truth, and nothing grows with the corpus without saying so. The bounds themselves:

- At most **10** references per document per direction. Each bullet carries the _full_ count, so `- from (124, showing 10):` is unambiguous about what you are not seeing. The unit is **edges, not distinct documents**: the graph keeps one edge per reference written in the source (a plain link and an anchored one to the same file are two edges), so one referencing document can occupy several of the ten slots and appear more than once in the list. This is why the count in the bullet can be far larger than the number of documents behind it, and why `wastech-mdlint impact <file>` — which reports the referencing _files_ — is the better tool for "who depends on this".
- At most **25** documents get a `### References` entry, and at most **25** get a `Document Architecture` row. It is deliberately the same number and the same 25 documents: the ranking — total references first, then path — decides _which_ ones are described in detail, not where they appear, since both blocks render in path order. When either bound engages, the artifact names how many documents were omitted.

All bounds are fixed rather than corpus-relative: they do not engage below the bound, and the rule the artifact states means the same thing in every repository instead of varying with corpus size. A cycle path is elided past eight entries for the same reason.

**Capping the table drops columns, not documents.** A document past the 25-row bound loses its `Role`, `Type` and degrees; it is still listed by `Reading Order`, which is not capped. That asymmetry is the whole reason the table can be capped and the reading order cannot: a document silently missing from the reading order is the exact dishonesty that block exists to prevent.

Two things that fixed bounds do **not** promise, both worth knowing before you diff a committed `SKILL.md`:

- **This release re-renders every artifact once.** The `Document Architecture` bound, its disclosure paragraph, and the `Complete:` lines on the two uncapped blocks change the bytes and the content hash of every generated `SKILL.md`, whatever the corpus size. Regenerate and commit the result; after that, the same inputs produce the same bytes again.
- **The document bound is a top-25 selection, so it is not local.** Adding a well-referenced document elsewhere in the corpus can push an existing one out of both lists — dropping its `### References` entry and its table row, and changing the omitted counts — even though nothing about that document changed.

**The full graph is not lost** — `wastech-mdlint graph --format json` has the complete edge list plus every document's in- and out-degrees, and `wastech-mdlint impact <file>` has one document's, which is what the disclosure paragraphs point at. `Role` and `Type` are derived by `compile` and appear in no other output.

### The `Context Budget` numbers are estimates

The corpus total and the per-entrypoint breaches in that block come from the same heuristic [SIZE-001 and LLM-001](concepts.md#token-estimation) use — `ceil(characters / 4)`, which errs **low** for non-Latin scripts. Unlike a lint finding, which now states that calibration in its own message, the block states it nowhere: the artifact is loaded into an agent's context whole, so a sentence repeated per entrypoint costs the context the block exists to protect, and adding it would move the bytes and content hash of every committed `SKILL.md` for a disclosure the reader can get here. Read those numbers as an order of magnitude, and set the budgets they are measured against with headroom.

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
  "hubMinInDegree": 3           // in-degree threshold for a hub, here and in `graph` (default 3)
}
```

- `skill.name` / `skill.description` are required.
- `sections.*` toggle the four generated sections.
- `commandPreset` selects the phrasing of the "Working with dependencies" block.
- `hubMinInDegree` tunes hub classification — here **and** in [`graph`](context-graph.md#graph), whose `top hubs` list applies the same threshold so the two reports cannot disagree about whether a given document is a hub. It is the one `compile.*` key that reaches a surface outside this command. **The `Role` column is coarse at scale**, and raising this does not change that: on a 139-document corpus the five roles land 73 `hub` / 46 `isolated` / 11 `entry` / 5 `bridge` / 4 `leaf`, so two buckets hold 86% and in practice read as "has edges" versus "has no edges". `isolated` is a true fact about the corpus that no threshold touches, and an absolute in-degree threshold cannot be scale-free — 3 is meaningful at 10 documents and noise at 1000. Read the `Refs (in/out)` column beside it for the degrees the bucket rounds off; it is what separates a 3-reference hub from a 124-reference one. The coarseness is a deliberate trade rather than a defect: a scale-free classifier would have to be relative to corpus size, and a role whose meaning shifted as documents were added would be harder to read than one that is plainly approximate.
- `hubMinInDegree` does **not** bound the dependency section — that is the fixed cap above, deliberately kept separate because this option governs role assignment.
- Unknown `compile.*` keys are rejected like any other unknown config key.

## Compile vs. static skills

`compile` produces a **generated, project-specific** skill. The three **hand-authored** skills (`-init`, `-fix`, `-impact`) are separate and shipped as-is — see [Skills](skills.md). Both share one frontmatter schema in core.

## Via MCP

The [`compile-context`](mcp-server.md) MCP tool produces the same deterministic output as this command (as two plain-text blocks). It also requires `config.compile`.
