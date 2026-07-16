Address the failing checks and/or blocking review findings recorded in the context files. Make the minimal change that fully resolves them — including other instances of the same defect the findings reveal (see "Fix The Finding, Then Its Class"). If a `human_input` context file records a denied dangerous change, remove or safely rework that change.

## Scope Discipline

- Stay strictly within scope: fix only what _your_ change broke and what the task asked for. Do not edit files outside the task's scope to chase an unrelated failure.
- Do **not** work around a failure caused by a missing or incompatible host toolchain (for example, an SDK or runtime version the environment does not provide), or by a check that was already failing before your change. Changing target frameworks, pinning toolchain versions, or disabling such a check is out of bounds.
- Leave those failures as they are, revert any experiment you made toward them, and describe them plainly in your final message so a human can act — a check that cannot pass in this environment is not yours to "fix".

## Fix The Finding, Then Its Class

Resolve every reported finding — but each finding names one instance of a mistake that is usually repeated in the same artifact. Fixing only the exact line the reviewer cited sends the change back for another full review round to surface the next instance: slow and expensive.

- Fix each finding at its cited location, treating the `fix:` hint as a lead, not ground truth. When the finding concerns a factual claim about this product — a CLI command/flag/option value, a core contract or result shape, an MCP tool or its schema — re-open the authoritative source and confirm the corrected claim there rather than trusting the finding's wording.
- Then re-check the rest of the same artifact for other instances of the same defect class the finding exposed: every other command/flag reference, every other output-field or path claim, the same edge case (CRLF, duplicate keys, nested target) elsewhere. Fix those in this same round.
- This is deliberately broader than the single cited line, but it is not the scope-widening forbidden above: stay within the task's files and the categories the review already raised, and resolve each class exhaustively instead of one occurrence at a time.

## Quality Gate

The project's gate is:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Work one failure at a time: reproduce it with the matching command, fix it minimally, then re-run that same command to confirm it passes before moving on.

Keep the project's invariants intact while fixing:

- sorted output arrays and repository-relative POSIX paths (normalize `\` to `/`)
- ESM / `NodeNext` imports with explicit `.js` specifiers, and `strict` types with no `any`
- the mandatory rules in `.agents/rules/` (architecture, coding-style, security, testing)

`npm` may warn that the host Node is older than the project's `engines` range (`>=24.17.0`); that warning is not itself a failure to chase.

## Additional Project Context

{?memory_path}A brief of repository memory relevant to this task — failure signatures with their canonical remedy, known-fragile areas, and entity notes for the files you are touching — is at {memory_path}. Check it for a known fix before improvising; treat it as advisory and verify each point against the current code (it can be stale).{/memory_path}

{?subtask_spec_path}You are fixing subtask {subtask_order} of {subtask_count}; keep your change scoped to that subtask's spec: {subtask_spec_path}{/subtask_spec_path}
