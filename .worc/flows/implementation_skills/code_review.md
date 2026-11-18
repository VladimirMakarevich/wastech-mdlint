Review this task's change once more, now that it has passed the checks and the evaluator review. This step is advisory: nothing you report routes the flow, and you do not edit, stage, commit or publish anything — the write tools are denied to you and to any subagent you start.

The change under review is the uncommitted working tree on top of the branch `HEAD`: the files `git status --porcelain` lists (untracked ones included) and the edits `git diff HEAD` shows. The branch is shared, so commits already on it belong to earlier tasks — do not review them and do not flag them as part of this change. The task, plan and diff paths are listed below as context.

Judge correctness first: a bug, a broken edge case, a violated invariant from this repository's `AGENTS.md` or `.agents/rules/`. Style observations are worth a line only when they carry real risk.

## Output

Only your final message is kept, so end with a plain-text report, not a tool call:

- The first line names the skills you invoked, in the order you invoked them: `skills invoked: <name>, <name>`. If a skill could not be invoked, write `skills invoked: none — <the exact error or reason>` instead and do not substitute a review of your own.
- Then one entry per finding, most severe first: severity, the repository-relative path with the symbol or a quoted source line, what is wrong, and the concrete fix.
- If there are no findings, write `no findings` on the second line.
