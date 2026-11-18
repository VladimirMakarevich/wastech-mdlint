---
name: mdlint-code-review
description: Review the current uncommitted change in this repository with Claude Code's built-in code-review skill and report the findings without editing anything. Use when a step asks for a code review of the working-tree change.
---

# mdlint-code-review

This repository's code-review step. It delegates the review itself to Claude Code's built-in `code-review` skill, so every review follows one maintained recipe instead of a copy that drifts.

## Steps

1. Find the change: the uncommitted working tree on top of `HEAD`. `git status --porcelain` gives the file list, untracked files included; `git diff HEAD` gives the edits. Commits already on the branch are not part of the change.
2. Invoke the built-in skill through the Skill tool: skill `code-review`, args `high`. Do not add `--fix` or `--comment`: this step only reports, and nothing is edited, staged or posted.
3. If the Skill tool is unavailable, the `code-review` skill is not in your skill list, or the invocation fails, do not substitute a review of your own. Say so plainly, quoting the exact error text.
4. When the skill finishes, restate its findings as plain text in your final message — one entry per finding, most severe first, each with a severity, the repository-relative path with the symbol or a quoted source line, what is wrong and the concrete fix — so they survive in a log that keeps only the final message.
