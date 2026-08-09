# P19.05 — Two messages that state more than they mean

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.
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

## Outcome

**F-08.** Both `REF-005` branches now state the lookup they performed instead of a claim about the corpus:

- `Definition "REQ-2" is not referenced: it is not in the "ID" column of any table in "design.md".`
- `Reference "REQ-9" has no definition: it is not in the "ID" column of any table, or in a heading, in "reqs.md".`

The asymmetry is deliberate and load-bearing: references are column-only, definitions are that column plus heading tokens, so the two messages name different scopes and different places. Globs are quoted before being joined, because a brace list contains commas of its own.

**F-02.** The `files` hint is derived from the rule's own options schema rather than a maintained rule list — read as `schema.json` reads it, so the diagnostic and the schema an editor validates against cannot disagree. A rule with no `files` key is told so and pointed at the top-level `include`/`exclude`; a rule that additionally declares a bare `exclude` has that key's real meaning spelled out, which is exactly the pair the file-scope inventory pins. That covers the four other rules with no file scope for free. The hint is appended to the issue **message**, not carried as a structured `hint`, because the CLI prints a config error's message and drops its `hint` — an explanation anywhere else never reaches the terminal where this mistake is made.

## Exit criteria

- [x] `REF-005`'s orphan message names the column and the reference scope it searched.
- [x] A config with `files` on REF-001 or REF-003 is rejected with a message that says why the key is absent and where to scope instead.
- [x] Both are covered by assertions on the message text.
