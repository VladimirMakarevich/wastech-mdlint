# 07 · Deferred

> Part of the [viewer review plan](index.md).

Ideas from the same discussion that are not scheduled. Each should wait until phases 01–06 have been used for real, and each becomes its own plan when it is picked up. Next to each is what it would need.

| Idea | What it needs |
| --- | --- |
| Per-section marks: a section stays reviewed while its own text is unchanged, even when another section of the same document moved on | A stable section identity across heading renames, and a decision on whether renaming a heading resets its section's mark |
| File history on the banner: the commits that last touched the document and when | `git log --follow -z` through phase 01's module; commit dates are deterministic for a given repository state. Author names are personal data, so shown only on a loopback binding, as absolute paths are |
| Blame in the margin: the commit that last touched each block | `git blame --porcelain` mapped onto the block ranges from phase 04, sharing the right margin with the source line numbers |
| `--since <ref>` for the CLI's `lint` and `impact` and as an option of the existing MCP tools | Phases 01, 02 and 05 from core; a host-parity guard for the new option. No new MCP tool, so the six read-only tools stay six |
| Refreshing open Changes pages the moment `HEAD` moves, without waiting for a request | A watcher on the git common directory and the worktree's own git directory, limited to `HEAD` and refs, kept apart from the corpus watcher |
| Expanding context in a diff ("show 20 more lines") and showing a moved paragraph as a move rather than a deletion plus an addition | Phase 02's hunks carrying their surrounding lines; a moved-block pass over matched removals and additions |
