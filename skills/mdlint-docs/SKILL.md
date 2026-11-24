---
name: "mdlint-docs"
description: "Keep a repository's Markdown inside its wastech-mdlint size budgets without losing content: find the SIZE-001 and LLM-001 findings, decide who owns the fix, compress the wording for as long as no meaning or quality is lost, and only then split the document by meaning or continue it in a file beside it, planned from the impact blast radius, and verify with lint. Use when a Markdown file is over or near its budget, when an edit will not fit in a file, or when the user asks to tighten, split or restructure docs, skills or agent context."
license: "MIT"
compatibility: "Requires @wastech-mdlint/cli 0.3.0. One tag publishes the CLI and tags the skills together, so a skill and the CLI it drives always carry the same version; do not mix versions."
metadata:
  homepage: "https://github.com/VladimirMakarevich/wastech-mdlint"
  source: "https://github.com/VladimirMakarevich/wastech-mdlint"
---

# Fit Markdown back into its budget: compress, then split

This skill answers a size budget without losing any knowledge: first by compressing the wording for as long as that costs no meaning and no quality, and only then by giving the document a finer-grained structure. It is a policy layer over the CLI — wastech-mdlint measures, this skill decides what to do about the measurement.

Hard constraints, for every step below:

- **A budget is never a reason to drop content.** The edit the user asked for goes in, in full. Refusing it, leaving part of it out, or deleting other useful text to make room are all forbidden. The budget limits the _file_, not the _knowledge_.
- **Compress first, split second.** Tightening the wording is allowed for as long as no meaning and no quality is lost (step 4). Only a file still over budget once compressing cannot go further is split into finer-grained files or continued in a second file beside it (steps 5–7).
- **Do not raise the threshold.** A budget moves only when a whole class of files grows, and only with the user's agreement. Never add an inline disable or switch a rule off to get a clean run.
- **A pending decision never holds content back.** When compressing or splitting needs the user (step 3), make the requested edit anyway, leave the file over budget, and say so in your report.

Run the steps in order.

## 1. Verify setup

Confirm a `wastech-mdlint.config.json` exists: start from the working directory and walk up its ancestors (a nested `docs/` or `packages/foo/` can carry its own config, and `lint` resolves the config by the same walk-up). If none exists, stop and point the user at the `mdlint-init` skill — do not hand-write a config here. Run every command below from the directory that owns the config.

Invoke the CLI through the repository's package manager — there is no reliable bare `wastech-mdlint` binary on `PATH`, and `npx` is npm-specific. Pick the form matching the lockfile in the config's directory (`bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm):

- npm: `npx wastech-mdlint <args>`
- pnpm: `pnpm exec wastech-mdlint <args>`
- yarn: `yarn wastech-mdlint <args>`
- bun: `bunx wastech-mdlint <args>`

The examples below use the npm form; substitute your package manager's form throughout.

**Read the repository's own agent rule first, if it has one.** `init` can write one to `.agents/rules/wastech-mdlint.md`, and the user is expected to edit it — above all its table of who decides on compressing or splitting. Where that page and this skill disagree, the page wins: it describes this repository, this skill describes the default.

Budgets are what the config says they are. Read them from the config or from the findings below, never from memory or from this skill.

## 2. Find what is over budget

Make the requested edit first, then measure:

```bash
npx wastech-mdlint lint --format json --fail-on off
```

`--fail-on off` keeps the exit code at `0`, so a finding is data rather than a failed step. Keep the entries of `messages` whose `ruleId` is one of these two:

- **`SIZE-001`** — one file over a budget. `filePath` is the file; `data.metric` is `bytes`, `lines` or `tokens`, `data.actual` the measured value, and `data.warnAt` / `data.errorAt` the configured thresholds.
- **`LLM-001`** — an entrypoint such as `CLAUDE.md` whose eager `@` import closure is over budget. `filePath` is the entrypoint; `data.totalTokens` is the closure's estimated size, `data.maxTokens` the budget, and `data.importedFiles` how many files the closure pulled in. The large thing here is the _closure_, not necessarily the entrypoint: the remedy is to compress or split an imported file, or to turn an import that need not load every session into an ordinary link — and since that changes what every session loads, it is always the user's call.

The `severity` decides urgency:

- **`warning`** — the file is close to its budget. Report it and propose what to do: compressing, and a split if compressing is not enough (step 3 decides who carries it out). The change itself is not blocked.
- **`error`** — the file is brought back under budget — compressed, then split if that is not enough — before the change is finished, subject to step 3.

No `SIZE-001` or `LLM-001` finding means nothing to do: stop here.

## 3. Decide who owns the fix

Unless the repository's agent rule says otherwise (step 1):

| What is over budget | How it is compressed or split |
| --- | --- |
| Documentation under `docs/` | You do it on your own and list in your report what you tightened and every new file |
| Skills, agents and commands (`.claude/`, `.agents/skills/`, `skills/`) | Only after the user confirms your plan |
| Agent rules and entrypoints (`.agents/rules/`, `AGENTS.md`, `CLAUDE.md`) | Only after a discussion with the user: the wording and the structure of the rules are the user's decision, and your plan is a starting point, not a request for approval |
| Anything not listed above | Ask the user first |

## 4. Compress without loss

Before planning a split, tighten what the file already says. Compressing is allowed — and is the first answer to "it does not fit" — for as long as no meaning and no quality is lost.

Allowed:

- removing repetition, and statements that restate what the file already says elsewhere;
- merging statements that say the same thing into one;
- cutting filler, hedges and introductions that carry nothing;
- turning a wordy passage into a shorter sentence, a list or a table that carries the same facts.

Not allowed, because this is where meaning or quality goes:

- dropping a fact, constraint, example, edge case, or the reason behind a rule;
- shortening the edit the user asked for;
- telegraphic fragments, private abbreviations, or a vaguer generalisation standing in for specific statements;
- anything that makes the text harder to read or open to a second interpretation.

The check: a reader of the compressed text learns everything the original taught them, just as easily. Compressing is over once every remaining sentence carries something of its own — stop there, even if the file is still over budget.

Where step 3 leaves the fix to you, apply the compression and measure again with the step 2 command; if no `SIZE-001` or `LLM-001` finding is left for the file, go to step 8. Where step 3 needs the user, do not apply it yet: it goes into the plan (step 6), together with the split it may still need.

## 5. Measure the blast radius

When compressing alone cannot bring the file under budget, find every document that links to the file you are about to split:

```bash
npx wastech-mdlint impact <file> --format json
```

`directlyAffected` lists the documents that link to the file, each with how many `references` it holds — those are the links that may need retargeting once sections move. The `mdlint-impact` skill covers the rest of this output, and the MCP route when the host exposes it.

## 6. Draft the plan

Put this to the user whenever step 3 says the fix needs them, and include it in your report otherwise:

- **What triggered it:** the file, the rule (`SIZE-001` or `LLM-001`), and the current size against the budget, from the finding's `data`.
- **What compressing gives:** what you tightened or would tighten, roughly how much that saves, and why it cannot go further without losing meaning or quality.
- **If that is not enough, the new files:** paths, names, and what each of them covers — one topic, or the continuation of the original.
- **What stays in the original file,** and how it routes the reader to the parts.
- **Which inbound links change** (from step 5) and which indexes or registries get updated.

While the plan waits for the user, the requested edit stays in place in full and the file stays over budget. Your report says so honestly: what `lint` reports, why, and the plan.

## 7. Split by meaning

Split only what compressing could not bring under budget, in one of two forms, chosen by the shape of the document:

- **Finer-grained files** when the document covers several topics that read on their own: each topic moves to a file of its own, and the original becomes a router to them.
- **A continuation file** when the document is one topic that runs past its budget — a long reference, a growing list, a sequential procedure: the original keeps what fits, and a second file beside it carries the rest.

1. **Split by meaning, not by line count.** Each part is one coherent topic that reads without the others, and a continuation starts at a section boundary — never a cut in the middle of a thought.
2. **The original path stays the entry point.** It keeps the essentials and routes the reader on. A router says what lives where and when to read it, with a link to each part; a continued file says, where it ends, what the continuation holds, and links to it. Links into the original keep working; links to anchors that moved are updated in the same change.
3. **Each part goes next to what it came from,** and a continuation file is named after the original, so the two stay side by side:
   - a skill keeps its trigger `description`, its workflow and its hard constraints in `SKILL.md`, and moves the details to supporting files beside it (for example `references/<topic>.md`), each linked with a line saying when to read it — an agent or a command does the same;
   - a rule becomes sibling files in its rules directory, registered wherever the rules are listed;
   - `AGENTS.md` and `CLAUDE.md` move details to a file reached by an ordinary link, never by an `@` import, because `LLM-001` counts only what is imported eagerly;
   - a document under `docs/` becomes sibling files, or a folder with an index page.
4. **Nothing is lost or duplicated.** Every statement of the original ends up in exactly one part — moved, not paraphrased away, and not copied into several parts.
5. **Each part lands well under its warning threshold,** so the next edit does not trigger the same split again.

## 8. Verify and report

```bash
npx wastech-mdlint lint
```

The work is done when this reports no `SIZE-001` or `LLM-001` finding for the files you touched and nothing new besides.

On a branch, check "nothing new besides" against the branch the change will merge into (`main`, say) rather than by eye:

```bash
npx wastech-mdlint lint --since main --format json --fail-on off
```

`messages` then holds only the findings the work tree adds since the merge-base with `main` — on unchanged documents too, such as an anchor a moved section broke — and `since.removed` the findings it removes, where a budget finding the split resolved shows up. It needs a git work tree with history back to the merge-base; outside one it exits `2` with git's remedy, and the plain `lint` above is the check. Where the config enables them, `REF-001` and `REF-002` catch a link or anchor a move broke, and `GRP-001` catches a reference cycle a new router or continuation link introduced — fix those in the same change.

Report what you tightened, the new files with their topics, the links you retargeted, and anything still over budget with the reason (a plan waiting on the user is a reason; running out of room is not).

## Next steps to mention

Point the user at the companion skills: `mdlint-fix` for the findings this skill does not handle, and `mdlint-impact` for the full blast radius of a change. Keep these as pointers — this skill's job ends at a clean `lint` or an honest report of why it is not clean yet.
