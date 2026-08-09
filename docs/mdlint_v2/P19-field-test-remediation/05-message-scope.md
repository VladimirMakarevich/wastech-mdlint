# P19.05 — Two messages that state more than they mean

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.
>
> Closes [F-02](../field-test-2026-08-09-debates.md#f-02--files-on-ref-001ref-003-is-rejected-with-a-bare-unrecognized-key) and [F-08](../field-test-2026-08-09-debates.md#f-08--ref-005-says-never-referenced-when-it-means-not-in-the-id-column).

## Goal

Make two messages survive the first thing a reader does to check them.

## Sequence

- **Previous:** — · **Next:** —.
- **Depends on:** — · **Blocks:** —.

## Problem

**F-08 — `REF-005` says "never referenced" when it means "not in the ID column of a reference file".** Its page documents that references are column-only, and the rule behaves exactly as designed. But the message states a fact about the world that `grep` refutes: on the field-test target it reported five definitions as never referenced while four appeared in reference documents, one of them in a filename. The reader's next move is to distrust the tool rather than re-read the rule page, and the one finding that might have been actionable was buried in four that looked wrong.

**F-02 — `files` on REF-001/REF-003 is rejected with a bare `Unrecognized key`.** These are the two rules that take no file scope, and whose `exclude` filters link and image _targets_ rather than source documents. The behavior is documented in three places; the diagnostic is the part that knows the answer and does not give it, in a product that answers an unknown rule id with `Did you mean "REF-001"?`.

The two mistakes it fails to separate are not equivalent: `files` is a hard error and therefore safe, while `exclude` meaning "skip these source files" type-checks, runs, and silently filters something else. The field test measured that difference — excluding one path removed exactly the three of six findings whose targets lived there, leaving both source documents in scope.

## Deliverables / steps

1. **Name the scope in `REF-005`'s orphan-definition message** — the column and the reference globs it actually searched. The dangling-reference branch beside it has the same shape and takes the same fix.
2. **Give REF-001/REF-003 a hint for `files`**, in the register the unknown-rule hint already established: that the rule takes no file scope, that its `exclude` filters targets, and that the top-level `include`/`exclude` is where to scope it.
3. **Tests** that assert on the message text, not only on the finding count — these are message defects, so a count-based assertion would pass both before and after.

## Exit criteria

- [ ] `REF-005`'s orphan message names the column and the reference scope it searched.
- [ ] A config with `files` on REF-001 or REF-003 is rejected with a message that says why the key is absent and where to scope instead.
- [ ] Both are covered by assertions on the message text.
