# P19.02 — The scan disclosure describes the written config's boundary

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.
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

## Exit criteria

- [ ] No file the block reports as excluded is in the corpus the config it wrote produces.
- [ ] Every count in the block reconciles with the list printed beside it.
- [ ] A repository with a nested dot-directory under a proposed cluster is covered by a test.
- [ ] The guidance line names a pattern that would work for the directory it is talking about.
