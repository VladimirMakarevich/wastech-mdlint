---
name: worc-task
description: Convert a task into one valid wastech-orchestrator task file (YAML front matter + Description / Acceptance criteria / Constraints), ready for tasks/pending/. Handles two intakes — a raw free-form request (draft it, enriched with goals/out-of-scope/doc links) or an already-written spec/task doc (preserve it verbatim, add only what is missing). Use when you have an informal task, a ticket, a Slack message, or a structured project/roadmap task file and want a ready-to-run orchestrator task.
---

# worc-task

Turn a task into **one** valid wastech-orchestrator task file. The orchestrator is not a chat agent: it takes a single task file and drives it through a fixed pipeline (refinement → planning → implementation → testing → review → fixing → summary → publishing), then commits a branch and opens a PR. **One task = one branch = one PR.** Your job is to produce a file that passes the validation gate on the first try — and, when the input is already a well-written task, to do so **without throwing away its quality**.

Two intakes, two postures:

- **A well-written spec/task doc** (e.g. a roadmap phase file with Goal / steps / criteria) → **preserve it; do not rewrite.** Carry its substance across verbatim and add only the pieces the orchestrator requires but the doc lacks.
- **Raw free-form text** (a paragraph, a ticket, a Slack message) → **draft it**, and enrich it with the goal, an out-of-scope note, nuances, and doc links so the orchestrator has enough to work with.

Speak in the user's language (default to the language they wrote in).

## When to use

- The user pasted a free-form task ("add X", "fix Y", a ticket body) and wants it as an orchestrator task.
- The user points at an **already-structured task/spec doc** (a roadmap phase file, a design doc, an issue with sections) and wants it converted into a runnable task **without losing its content**.
- Use this for a **single coherent change**. If the work is several **independent** changes, make **separate task files** (each becomes its own PR). If it is **one** change you already know how to split into ordered steps that should land together as one PR, use **worc-deco-task** instead.

## Preserve, don't rewrite (the core rule)

Understanding how the orchestrator reads a task file is what makes preservation safe:

- The gate allowlists **only the front-matter keys**. The **entire body** — every `##` section — is passed to the agent as context; nothing in the body is rejected for being an "unexpected" section. So `## Goal`, `## Deliverables / steps`, `## Sequence`, `## Decisions applied`, `## Hand-off`, tables, and code blocks are all safe to keep **verbatim**.
- Exactly **two** body headings are semantically special:
  - **`## Description`** — its section (or, when the heading is absent, the whole body) must be **non-empty**. Any what/why statement satisfies this.
  - **`## Acceptance criteria`** — the orchestrator recognizes only this **literal** heading. When it is present (with a non-empty description), the orchestrator **skips the refinement stage** and runs the criteria as authored.

### Mode A — a well-written source doc

1. **Copy the substance verbatim.** Bring the source's real sections (Goal, steps, decisions, invariants, examples) into the task body unchanged. Do not paraphrase, summarize, or "improve" content that is already clear — that clarity is the quality you are told to keep.
2. **Add `## Description` only if the source states no what/why.** A source `## Goal` / `## Overview` / `## Summary` / `## Objective` already serves as the description (the orchestrator uses the whole body), so don't duplicate it. Add a concise `## Description` (1–3 sentences: what changes, why, the end state) only when nothing in the doc states it.
3. **Add or re-head `## Acceptance criteria` only if absent.** If the source already lists testable criteria under another name — `## Exit criteria`, `## Success criteria`, `## Definition of Done`, `## Checks` — **rename that heading to `## Acceptance criteria`** and keep its items verbatim. This is not rewriting: it makes the orchestrator recognize the criteria the author already wrote (and skip an unneeded refinement pass). Author new criteria only when the doc genuinely has none. (If you would rather refinement still enrich the criteria, leave them under their original non-recognized heading — that is a deliberate choice, not the default.)
4. **Fix the links** (see [Referencing supporting docs](#referencing-supporting-docs)) and **sanitize the title** (see [How to run](#how-to-run)).
5. **Drop only pure tracking noise** — roadmap `Size`/`Status` badges, board metadata, cross-phase `Next`/`Blocks`/`Hand-off` navigation that describes _other_ work — never drop substance of _this_ change. Keep `Depends on` (it may map to front matter — see below).

### Mode B — raw free-form text

Draft the task from the text (per [How to run](#how-to-run)) and, since the input is thin, deliberately add: the **goal / end-state**, an **out-of-scope** note wherever the boundary is unclear, any **nuances or constraints** you can reasonably infer, and **links to relevant docs**. Prefer to draft and let the user adjust over interrogating them.

## How to run

1. **Read the input and pick the mode.** A structured doc → Mode A (preserve). Raw text → Mode B (draft + enrich). Ask **at most** a couple of clarifying questions, and only when a required field genuinely cannot be derived (or you would otherwise have to invent acceptance criteria the author didn't write).
2. **Derive the fields:**
   - `id` — a stable, lowercase slug. **Must match** `^[a-z0-9][a-z0-9._-]{0,63}$` (starts with a letter/digit; then letters, digits, `.`, `_`, `-`; 1–64 chars). No spaces, no uppercase, no leading separator. For a phase/spec doc, derive it from the phase code + topic (e.g. `p5-01-classify-nodes`). Invalid ids are **rejected, never sanitized**.
   - `title` — a short, specific, imperative line, **plain text only**. Strip Markdown from a doc's `#` heading: no backticks, no `·`, no code spans — they trip the injection scan (hard rule 7). E.g. `# P5.01 · classifyNodes + analyzeGraph` → `title: "P5.01 classifyNodes and analyzeGraph"`.
   - `## Description` — per your mode (Mode A: only when the source has no what/why; Mode B: always, concrete and non-empty).
   - `## Acceptance criteria` — a testable checklist (see below); in Mode A, **re-head the source's existing criteria** rather than inventing.
   - `## Constraints` — do-not-touch areas, dependency limits, compatibility/migration limits.
3. **Set optional front-matter fields only when clearly warranted.** Default to omitting them — the defaults are almost always right. Map a source doc's "Depends on: `<other item>`" to `depends_on:` **only** if those upstream items are themselves queued as orchestrator tasks under matching ids; otherwise keep them as prose/links in the body, not front matter.
4. **Write the file** to `tasks/pending/<id>.md` (the canonical location, git-tracked). If you cannot find a `tasks/pending/` directory, confirm where it lives or fall back to the repo root, and tell the user.
5. **Self-check** against the hard rules below before finishing.

## Write testable acceptance criteria

Each criterion should name the behavior, the input, and the expected output.

Good:

```markdown
- [ ] `GET /users?page=2` returns the second page using the existing pagination metadata.
- [ ] Invalid page values return HTTP 400 with the existing error shape.
- [ ] Add unit tests for valid and invalid page values.
```

Avoid (vague, untestable): "Make pagination better.", "Clean up the API."

If acceptance criteria are present **and** the Description is non-empty, the orchestrator skips refinement automatically. Omit them only when you want the refinement stage to enrich an under-specified task (missing criteria never rejects the task — there is no flag).

**Recognized heading, verbatim content.** The refinement-skip only fires on the literal `## Acceptance criteria` heading. When a source doc already lists solid criteria under `Exit criteria` / `Success criteria` / `Definition of Done`, re-head them to `## Acceptance criteria` and keep the wording — do not re-derive weaker ones.

## Referencing supporting docs

Keep the task self-navigable so the agent can pull in the full context:

- **Rewrite relative links to repo-relative POSIX paths.** A source link like `[P4.08](../P4-graph/08-graph-tests.md)` written from `docs/mdlint_v2/P5-compile/` becomes `docs/mdlint_v2/P4-graph/08-graph-tests.md` — valid no matter where the task file sits. Never leave `../` links that break from `tasks/pending/`.
- **Add a `## References` section** pointing to the **source doc itself** and the docs it depends on (requirements, decisions, the previous phase), so the agent reads the full spec rather than only your excerpt.
- Links live in the **body**, never in front matter.

## The task contract (front-matter fields)

Only these keys are allowed. **Any other key makes the task rejected** (`unknown_top_level_field`).

| Field | Required | Type | Meaning |
| --- | --: | --- | --- |
| `id` | **yes** | string | Stable id. Must match `^[a-z0-9][a-z0-9._-]{0,63}$`. |
| `title` | **yes** | string | Short, non-empty human title. Branch slug + reports. |
| `task_type` | no | string | Flow selector. Omit ⇒ `implementation` (the default coding pipeline). Built-ins: `implementation`, `deep_research`, `security_audit`; operators add more as `<repo>/.worc/flows/<task_type>.yaml`. An unknown type (no matching flow) fails the task before any branch is created. The task only _names_ the flow — it never edits it. |
| `pr_title` | no | string \| null | PR title override, used verbatim instead of `title`. Does not change the branch name or commit messages. Omit to auto-generate. |
| `branch_mode` | no | `new` \| `existing` \| `current` | Where task git ops point. `new` (default) forks a fresh branch from base; `existing` works in `branch_ref`; `current` uses the current checkout as-is. Overrides `repo.branch_mode`. |
| `branch_ref` | no | string | Branch to check out — **required iff** `branch_mode: existing`; must already exist (never auto-created). Ignored for other modes. |
| `publish` | no | `commit` \| `push` \| `pull_request` | Downgrade-only cap on where the publish node stops (`min(flow_policy, publish)`). Omit ⇒ the flow's policy; no-op on a flow with no publish node. |
| `trust_level` | no | `strict` \| `auto` | Per-task override of the dangerous-diff approval threshold. `strict` gates every deletion/manifest edit; `auto` (default) gates only operator `protected_paths`. Never lowers the hard security ceiling. |
| `auto_merge` | no | boolean | `true` requests auto-merge of the PR (**DANGER — skips human review**); `false` always opts out; omit uses the instance default. A set per-task value wins outright. |
| `prompt_audit` | no | boolean | `true`/`false` forces prompt-audit recording for this task; omit uses the config default. |
| `decomposition` | no | boolean | `true`/`false` permits/forbids decomposition for this task (task-wins over `agents.decomposition.enabled`); omit uses the config default. Only flips the gate — the flow + planning still decide whether a split happens. Not for operator-authored `subtasks`. |
| `contacts` | no | list of strings | Plain-text mentions in Telegram notifications/HITL prompts. Cosmetic only — no access control, no chat routing. |
| `depends_on` | no | list of strings | Other **task ids** that must be **merged** before this task starts (non-blocking, merge-gated). For _separate_ tasks that build on each other. |
| `subtasks` | no | list of strings | Operator-authored decomposition (one root + ordered subtask spec files → one PR). **Use worc-deco-task to author this**, not by hand. |
| `nodes` | no | mapping | Per-node disable toggle, keyed by flow node id: `nodes.<node-id>.enabled: false`. `enabled` is the **only** valid sub-key. |

Body sections: `## Description` (required, non-empty) · `## Acceptance criteria` (present ⇒ refinement auto-skipped) · `## Constraints`. Any other `##` sections you keep (Goal, Deliverables, Decisions, References, …) are preserved and passed to the agent — they are not validated. If there are no `##` sections at all, the whole body is treated as the description.

### `nodes` (per-node disable)

The only per-node knob is `enabled: false`, keyed by a flow **node id**. The default `implementation` flow's node ids are `planning`, `implementation`, `testing`, `review`, `fixing` (and `refinement`, which is skipped automatically when the task is complete — not via `nodes`). Disabling effects: `planning` → stub plan, single unit; `testing` → straight to review, no checks; `review` → **commit with no agent review gate (high-risk)**; `fixing` → a failure spins the fix loop to its cap, then `manual_action_required`.

```yaml
nodes:
  testing:
    enabled: false # only for a repo with no meaningful test suite
```

## Hard rules — never emit a task that breaks these

The validation gate rejects a task **before** any branch or agent runs. To always pass:

1. The file **starts** with a `---` front-matter fence — no blank lines or text before it.
2. `id` and `title` are present; `id` matches the regex above.
3. `## Description` (or the body) is **non-empty**.
4. **Only** the allowed front-matter keys appear; types match the table.
5. `nodes` overrides carry **only** `enabled` (a boolean), keyed by a flow node id. Any other sub-key (including `model`/`reasoning`) is rejected (`invalid_node_override`).
6. **No secrets** (tokens, keys, passwords) anywhere in the file. Credentials live in the operator's environment, never in a task.
7. **Front-matter values are plain text.** No value may look like a CLI argument: a value that **starts with `-`** or contains an **argv-shaped token** (a backtick `` ` ``, `;`, `|`, `$(`, or a newline) is rejected as `injection_suspected`. This applies to **every** field, `title` and `contacts` included (the gate does not exempt display fields). Front matter is scanned defensively even though the body never builds CLI arguments — so put code, shell snippets, or punctuation-heavy phrasing in the **body**, and keep front-matter values to short plain labels (e.g. title `Fix parse() on empty input`, not `` Fix `parse()` on empty input ``). This is the usual trap when converting a doc whose `#` heading contains backticks or `·`.
8. Keep it reasonably sized (the gate caps file size, line count, and per-line length). When copying a doc verbatim, watch for over-long lines — the per-line byte cap can reject a very long unwrapped line.

**Provider, model, and reasoning are not task fields** — they live on the flow node (the operator's flow + config). A task cannot repoint a stage's provider or set its model. Never add `provider`, `model`, `reasoning`, or `agents` keys.

## Skeleton — raw text (Mode B)

```markdown
---
id: task-001
title: "Add a bounded retry budget to webhook delivery"
---

## Description

Webhook delivery should stop retrying after a bounded number of failed attempts. Store the attempt count with the existing delivery record and keep the current success path unchanged.

## Acceptance criteria

- [ ] Failed webhook delivery increments an attempt counter.
- [ ] Delivery stops after 5 failed attempts.
- [ ] Successful delivery still marks the record as delivered.
- [ ] Add or update tests for retry exhaustion and success.

## Constraints

- Do not change the public webhook payload shape.
- No new runtime dependencies without approval.
```

## Worked example — source doc (Mode A)

Converting the roadmap phase file `docs/mdlint_v2/P5-compile/01-graph-analysis.md`: keep Goal + steps + decisions **verbatim**, re-head `Exit criteria` → `## Acceptance criteria`, fold the dependency links into `## References` (repo-relative), sanitize the title. No `## Description` is added — the source `## Goal` already states what/why. The `Size`/`Status` badge and the cross-phase `Next`/`Blocks`/`Hand-off` navigation are dropped (they describe other phases, not this change); keep them only if they genuinely help execute _this_ task.

```markdown
---
id: p5-01-classify-nodes
title: "P5.01 classifyNodes and analyzeGraph"
---

## Goal

Classify graph nodes into roles and bundle the graph analysis the synthesizer needs.

## Deliverables / steps

1. classifyNodes(graph) → exactly one role per node from inDegree (in) / outDegree (out), first match wins: isolated → hub (in >= H, default 3) → entry → leaf → bridge. Mutually exclusive and exhaustive; degree-only (no articulation-point algorithm); H is a fixed, configurable threshold (compile.hubMinInDegree).
2. analyzeGraph(graph) → { readingOrder, excludedFromReadingOrder, components, classification }. Capture both order and excluded from topologicalSort; thread graph.cycles through so cycles render honestly.
3. Reuse P4 algorithms (no re-implementation).

## Decisions applied

- Reuses P4 graph/algorithms; R5 one graph.

## Acceptance criteria

- [ ] Node roles assigned deterministically.
- [ ] `analyzeGraph` returns reading order + components + classification.

## References

- Source spec: docs/mdlint_v2/P5-compile/01-graph-analysis.md
- Depends on: docs/mdlint_v2/P4-graph/08-graph-tests.md
- Rules engine (R5): docs/mdlint_v2/requirements/02-rules-engine.md
```

(Keep inline `code` and symbols like `>=` in the **body** as above; only the front-matter `title` must be plain text.)

## What not to do

- Don't invent `provider`, `model`, `reasoning`, or `agents` keys — they are flow concerns and get the task rejected.
- Don't add any front-matter key outside the allowed table.
- Don't embed secrets, and don't put CLI-flag-shaped or shell-punctuation values in **any** front-matter field (including `title`/`contacts`) — a leading `-` or a `` ` ``/`;`/`|`/`$(` gets the task rejected. Put such content in the body.
- Don't try to add, replace, or relax checks, or weaken the sandbox — those are operator config, not task fields.
- **Don't rewrite or paraphrase already-clear content** in Mode A — carry the source's steps, decisions, and examples across verbatim. Add what's missing; don't restate what's there.
- **Don't invent acceptance criteria when the doc already has them** under another heading — re-head to `## Acceptance criteria` and keep the wording.
- **Don't leave broken `../` doc links** — rewrite them to repo-relative POSIX paths and collect them under `## References`.
- **Don't drop the source's substance** to "tidy" it — only pure tracking noise (Size/Status, cross-phase navigation) may go.
