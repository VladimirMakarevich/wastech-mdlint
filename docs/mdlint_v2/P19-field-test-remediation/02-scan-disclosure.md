# P19.02 — The scan disclosure describes the written config's boundary

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.
>
> Closes [F-05](../field-test-2026-08-09-debates.md#f-05--the-scan-disclosure-counts-directories-and-lists-names) and [F-06](../field-test-2026-08-09-debates.md#f-06--the-scan-disclosure-reports-files-as-excluded-that-the-written-include-covers).

## Goal

Make every line of the excluded-from-the-scan block checkable against the config written beside it, since the block exists to be trusted without verification.

## Sequence

- **Previous:** [P19.01 — Inference measures what the config will run over](01-inference-scope.md) · **Next:** —.
- **Depends on:** [P19.01](01-inference-scope.md) — the disclosure describes what inference decided, so writing it after that settles means writing it once.

## Problem

**F-06 — the block reports files as excluded that the written `include` covers.** It states that 63 Markdown files sit in dot-directories and that _no include pattern above names one_, while the `include` two lines up contains `backend/**/*.{md,mdx}` and `mobile/**/*.{md,mdx}`, which match dotfiles. Twelve of the 63 were in the resulting corpus. The sentence is literally true and the inference it invites is false for 19% of its own count; the advice compounds it by suggesting a pattern for files already covered. On the same run, two of the eight cycles `GRP-001` reported were in files the user had just been told the scan excluded.

**F-05 — two lines count directories and list deduplicated names.** `3 directories skipped by name … — .git, node_modules` and `26 directories skipped … — .angular, .worc, Pods, bin, capacitor-cordova-android-plugins, +6 more`. Both counts are correct and neither reconciles with the list beside it. The hidden-directories line is exact, carries a per-name breakdown, and matched an independent measurement of the corpus to the file — it is the shape the other two should follow.

## Deliverables / steps

1. **Partition the hidden-directory count** into files no written `include` pattern selects and files a cluster pattern covers incidentally, and report only the first as excluded — or report both, labelled. The count is right; the claim attached to it is what needs narrowing.
2. **Drop the advice for the second group**, or make it name the pattern that would actually be needed rather than a template that does not apply.
3. **Make the other two lines reconcile**: count distinct names, or say `3 directories under 2 names`, or attach occurrence counts the way the hidden line does. One of the three, consistently.
4. **A test that walks the block's own numbers back to the corpus** — for each line, the count it states is derivable from the same scan the draft was built from.

## Notes — what was decided, and why

Both steps offered a choice and the task deliberately did not pick one. Neither is a first-run-experience policy call of the kind [P19.01](01-inference-scope.md) escalated, so both were decided here.

**Deliverable 1 reports both groups, labelled** — `hidden directories, not linted` and `hidden directories, linted anyway` — rather than narrowing the count and saying nothing about the rest. Narrowing alone satisfies the letter of the exit criteria and leaves the consequence the field test actually recorded: `GRP-001` reporting cycles in files the same screen had called excluded. Whichever way a reader is surprised, the surprise is the block's to prevent, and one of the two directions is only reachable by printing the second line. Its cost is one extra line on a repository that has an incidentally covered dot-directory, and none on one that does not — an empty group is omitted, so the ordinary case still renders three lines.

The split is **per file**, not per directory. An `include` can reach part of a hidden tree and not the rest, and a per-directory verdict would have to round one of the two counts to zero. A partly covered directory therefore appears on both lines with different counts, which is the honest rendering.

**Deliverable 3 attaches occurrence counts**, the third of the options listed, because the finding itself calls the hidden line "the shape the other two should follow" and that line's distinguishing property is exactly this: it names each entry with its own number. Counting distinct names instead reconciles the sentence at the price of the scale — a monorepo's 26 pruned trees reading as 11 — and stating both numbers reconciles the sentence but still not the list. The elided tail carries the total it drops (`+6 more (16)`) for the same reason the head count exists: a truncation marker that says how many _names_ were dropped tells the reader nothing about how much of the total they account for.

**What made the fix small:** the value the disclosure needed was already at the call site. `formatDraftSummary` was calling `resolveIncludeToWrite` and discarding everything but whether the answer was `undefined`; passing the patterns themselves closed F-06 without a second scope derivation, since that helper is the same one the writer uses. `PrunedDirectory` now carries `markdownFiles` instead of a `markdownFileCount` — one field rather than two that must agree, which is the drift F-05 is about — and the paths come from the same `"count"`-mode re-entry that produced the number, so nothing about which files the scan considers has changed.

**Not changed, deliberately:** the block header stays `Excluded from the scan:` and still heads a line saying those files are linted. Both are true of different things — the scan excluded them, the config does not — and that gap is the whole subject of the block. Renaming the header to describe the corpus would make the other three lines wrong.

## Exit criteria

- [x] No file the block reports as excluded is in the corpus the config it wrote produces.
- [x] Every count in the block reconciles with the list printed beside it.
- [x] A repository with a nested dot-directory under a proposed cluster is covered by a test.
- [x] The guidance line names a pattern that would work for the directory it is talking about.
