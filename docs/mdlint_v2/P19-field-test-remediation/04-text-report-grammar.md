# P19.04 — The text report's line grammar survives any message

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.
>
> Closes [F-11](../field-test-2026-08-09-debates.md#f-11--a-message-containing-a-newline-breaks-the-text-report-into-phantom-files).

## Goal

Keep one finding on one line, so the default output cannot name files that do not exist.

## Sequence

- **Previous:** — · **Next:** —.
- **Depends on:** — · **Blocks:** —.

## Problem

The text report's grammar is that an unindented line is a file and an indented line is a finding. `packages/core/src/engine/format-lint-result.ts` interpolates `message.message` straight into a one-line template, so a message containing a newline renders across two lines with the **continuation unindented** — which in that format means "file heading".

A checklist item wrapped across two source lines is enough. On the field-test target, 16 of 459 findings rendered this way; parsing the report back recovered 443 findings and produced 63 file names where the corpus has 54. JSON is unaffected, because it escapes the newline, and the summary counts stay correct — which is why nothing looks wrong.

The human report is the default output. A reader sees a filename that is the tail of a sentence, with findings filed under it; a CI annotator, an editor problem matcher, or a per-file count inherits the same error silently. Any rule that quotes source text can produce this, so the fix belongs in the renderer rather than in `CTX-002`.

This is also the class the `host-parity` guard exists to catch. It survived because the two sides of a parity comparison must be **different formulations** of the run: a check that re-renders the text with the renderer's own helper agrees with itself here. The parity test added by this task has to parse.

## Deliverables / steps

1. **Sanitize the message before interpolation** — collapse whitespace runs, or indent continuation lines so they cannot be read as a file heading. Whichever is chosen, the property to hold is that the number of unindented lines equals the number of files reported.
2. **Decide what happens to the information in the newline.** Collapsing loses the source's line structure inside the quoted text; indenting keeps it and makes rows multi-line. Say which, and why, next to the code.
3. **Add a parity guard that parses the rendered text** back into rows and compares against the JSON messages, tagged `@boundary-guard host-parity`. Its fixture is the minimal one from the field test: a checklist item wrapped onto a second line.

## Outcome

**Collapse, not indent.** `formatLintResultText` flattens whitespace runs to a single space before interpolation. Indenting the continuation would have preserved the quoted text's line structure, but a row spanning two lines still defeats everything that reads this format one line at a time — a CI annotator, an editor problem matcher, a per-file count — which is the audience the human report has. Collapsing runs rather than only line breaks additionally keeps the two-space field separator unambiguous, so a row can be split back into its four fields. Nothing is lost from the product: the JSON projection keeps `message` verbatim with its newlines escaped, and rules that quote source text keep the raw value in `data`.

The same flattening applies to the **file heading**, which is not a theoretical case: a finding attributed to a config entry rather than to a location (a missing `STR-001` required file, an unresolvable `SEC-003` template) reports the unnormalized path the user wrote, so the one line the whole grammar rests on is a user-supplied string. Grouping still compares the raw `filePath`, so the heading count cannot fall below the number of distinct files.

The guard is the shared parity corpus rather than a sixth tagged test: `PARITY_LINT_FIXTURE` gained the field test's own reproduction — an unchecked checklist item wrapped onto a second source line, under `CTX-002` — so the three existing `host-parity` guards that consume it now exercise it. Reverting the renderer fails five assertions across `packages/cli/test/lint.e2e.test.ts`, `packages/mcp-server/test/lint-files.test.ts`, and `packages/core/test/format-lint-result.test.ts`. `lintMessagesAsRows` restates the one-line projection independently, the same second-formulation discipline it already applies to the location rule; `readLintFindingLines` and its regex needed no change.

## Exit criteria

- [x] A corpus whose findings quote multi-line source text renders one finding per line.
- [x] In any report, the count of unindented lines equals the count of distinct files with findings.
- [x] The parity guard parses the text rather than recomputing it, and fails without the fix.
- [x] The choice made in step 2 is stated where the renderer is read, not only in this file.
