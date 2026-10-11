---
name: "mdlint-docs"
description: "Keep a repository's Markdown inside its wastech-mdlint size budgets without losing content: find the SIZE-001 and LLM-001 findings, decide who owns each split, draft a split plan from the impact blast radius, split the document by meaning, and verify with lint. Use when a Markdown file is over or near its budget, when an edit will not fit in a file, or when the user asks to split or restructure docs, skills or agent context."
license: "MIT"
compatibility: "Requires @wastech-mdlint/cli 0.1.3. One tag publishes the CLI and tags the skills together, so a skill and the CLI it drives always carry the same version; do not mix versions."
metadata:
  homepage: "https://github.com/VladimirMakarevich/wastech-mdlint"
  source: "https://github.com/VladimirMakarevich/wastech-mdlint"
---

# Split Markdown that outgrows its budget

This skill answers a size budget the one way that keeps every piece of knowledge: by giving the document a finer-grained structure. It is a policy layer over the CLI — wastech-mdlint measures, this skill decides what to do about the measurement.

Hard constraints, for every step below:

- **A budget is never a reason to drop content.** The edit the user asked for goes in, in full. Refusing it, shortening it, squeezing the wording until it fits, or deleting other useful text to make room are all forbidden. The budget limits the _file_, not the _knowledge_.
- **Split; do not raise the threshold.** A budget moves only when a whole class of files grows, and only with the user's agreement. Never add an inline disable or switch a rule off to get a clean run.
- **A pending decision never holds content back.** When a split needs the user (step 3), make the requested edit anyway, leave the file over budget, and say so in your report.

Run the steps in order.

## 1. Verify setup

Confirm a `wastech-mdlint.config.json` exists: start from the working directory and walk up its ancestors (a nested `docs/` or `packages/foo/` can carry its own config, and `lint` resolves the config by the same walk-up). If none exists, stop and point the user at the `mdlint-init` skill — do not hand-write a config here. Run every command below from the directory that owns the config.

Invoke the CLI through the repository's package manager — there is no reliable bare `wastech-mdlint` binary on `PATH`, and `npx` is npm-specific. Pick the form matching the lockfile in the config's directory (`bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm):

- npm: `npx wastech-mdlint <args>`
- pnpm: `pnpm exec wastech-mdlint <args>`
- yarn: `yarn wastech-mdlint <args>`
- bun: `bunx wastech-mdlint <args>`

The examples below use the npm form; substitute your package manager's form throughout.

**Read the repository's own agent rule first, if it has one.** `init` can write one to `.agents/rules/wastech-mdlint.md`, and the user is expected to edit it — above all its table of who decides on a split. Where that page and this skill disagree, the page wins: it describes this repository, this skill describes the default.

Budgets are what the config says they are. Read them from the config or from the findings below, never from memory or from this skill.

## 2. Find what is over budget

Make the requested edit first, then measure:

```bash
npx wastech-mdlint lint --format json --fail-on off
```

`--fail-on off` keeps the exit code at `0`, so a finding is data rather than a failed step. Keep the entries of `messages` whose `ruleId` is one of these two:

- **`SIZE-001`** — one file over a budget. `filePath` is the file; `data.metric` is `bytes`, `lines` or `tokens`, `data.actual` the measured value, and `data.warnAt` / `data.errorAt` the configured thresholds.
- **`LLM-001`** — an entrypoint such as `CLAUDE.md` whose eager `@` import closure is over budget. `filePath` is the entrypoint; `data.totalTokens` is the closure's estimated size, `data.maxTokens` the budget, and `data.importedFiles` how many files the closure pulled in. The large thing here is the _closure_, not necessarily the entrypoint: the remedy is either to split an imported file or to turn an import that need not load every session into an ordinary link — and since that changes what every session loads, it is always the user's call.

The `severity` decides urgency:

- **`warning`** — the file is close to its budget. Report it and propose a split (step 3 decides who carries it out). The change itself is not blocked.
- **`error`** — the document is split before the change is finished, subject to step 3.

No `SIZE-001` or `LLM-001` finding means nothing to split: stop here.

## 3. Decide who owns the split

Unless the repository's agent rule says otherwise (step 1):

| What is over budget | How it is split |
| --- | --- |
| Documentation under `docs/` | You split it on your own and list the new files in your report |
| Skills, agents and commands (`.claude/`, `.agents/skills/`, `skills/`) | Only after the user confirms your split plan |
| Agent rules and entrypoints (`.agents/rules/`, `AGENTS.md`, `CLAUDE.md`) | Only after a discussion with the user: the structure of the rules is the user's decision, and your plan is a starting point, not a request for approval |
| Anything not listed above | Ask the user first |

## 4. Measure the blast radius

Before planning, find every document that links to the file you are about to split:

```bash
npx wastech-mdlint impact <file> --format json
```

`directlyAffected` lists the documents that link to the file, each with how many `references` it holds — those are the links that may need retargeting once sections move. The `mdlint-impact` skill covers the rest of this output, and the MCP route when the host exposes it.

## 5. Draft the split plan

Put this to the user whenever step 3 says the split needs them, and include it in your report otherwise:

- **What triggered it:** the file, the rule (`SIZE-001` or `LLM-001`), and the current size against the budget, from the finding's `data`.
- **The new files:** paths, names, and the one topic each of them covers.
- **What stays in the original file,** and how it routes the reader to the parts.
- **Which inbound links change** (from step 4) and which indexes or registries get updated.

While the plan waits for the user, the requested edit stays in place in full and the file stays over budget. Your report says so honestly: what `lint` reports, why, and the plan.

## 6. Split by meaning

1. **Split by meaning, not by line count.** Each part is one coherent topic that reads without the others — never a "part 1 / part 2" cut in the middle of a thought.
2. **The original path stays the entry point.** It keeps the essentials and becomes a router: what lives where and when to read it, with a link to each part. Links into it keep working; links to anchors that moved are updated in the same change.
3. **Each part goes next to what it came from:**
   - a skill keeps its trigger `description`, its workflow and its hard constraints in `SKILL.md`, and moves the details to supporting files beside it (for example `references/<topic>.md`), each linked with a line saying when to read it — an agent or a command does the same;
   - a rule becomes sibling files in its rules directory, registered wherever the rules are listed;
   - `AGENTS.md` and `CLAUDE.md` move details to a file reached by an ordinary link, never by an `@` import, because `LLM-001` counts only what is imported eagerly;
   - a document under `docs/` becomes sibling files, or a folder with an index page.
4. **Nothing is lost or duplicated.** Every statement of the original ends up in exactly one part — moved, not paraphrased away, and not copied into several parts.
5. **Each part lands well under its warning threshold,** so the next edit does not trigger the same split again.

## 7. Verify and report

```bash
npx wastech-mdlint lint
```

The split is done when this reports no `SIZE-001` or `LLM-001` finding for the files you touched and nothing new besides. Where the config enables them, `REF-001` and `REF-002` catch a link or anchor the move broke, and `GRP-001` catches a reference cycle the new router introduced — fix those in the same change.

Report the new files with their topics, the links you retargeted, and anything still over budget with the reason (a plan waiting on the user is a reason; running out of room is not).

## Next steps to mention

Point the user at the companion skills: `mdlint-fix` for the findings this skill does not handle, and `mdlint-impact` for the full blast radius of a change. Keep these as pointers — this skill's job ends at a clean `lint` or an honest report of why it is not clean yet.
