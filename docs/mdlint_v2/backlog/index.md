# Backlog — deferred implementation tasks

> Roadmap: [v2 Index](../index.md) · Reference (not a precedence tier, and not a phase).

Work that is **shaped and understood but deliberately not scheduled**. A phase folder answers "what are we doing now"; this folder answers "what did we decide to do later, and what does the next person need in order to pick it up without re-deriving it".

It exists because the alternative kept losing things. A deferred item recorded only in a finished task's implementation notes is out of reach the moment that task closes — [P18.06](../P18-followup-burndown/06-plan-residue.md) closed one that had been deferred into notes and then missed by the very task it was deferred to. An item left in a phase's task table is read as work in flight, which is the other failure: it either blocks the phase from closing or gets quietly dropped from it.

## What belongs here

An item earns a file here when all three hold:

- **The problem is measured, not suspected.** The file carries the evidence — real numbers from a real corpus — so the next reader does not start by re-measuring.
- **The shape of the work is decided, or the open decision is named.** "Decide X first, here are the options and what each costs" is a valid state; "something should be done about X" is not.
- **A cheaper part has already shipped, or there is a reason none could.** Splitting is the norm: take the cheap high-value half now, leave the expensive half here with what it still buys.

What does **not** belong: a defect (fix it), an idea nobody has costed (it is a note, not a backlog item), or a decision that was taken and accepted — that is a row in the [accepted-behaviors register](../accepted-behaviors.md).

## How an item leaves

It becomes a task file in a phase folder, and its file here is **deleted** rather than marked done — the phase task is then the only record, the same rule the register uses for a behavior a later task actually fixes. If an item is instead decided against, it becomes a register row and the file is deleted too.

## Items

| Item | Why it is deferred | Related |
| --- | --- | --- |
| [Per-node reason for the graph's excluded set](excluded-reason-attribution.md) | The cheap half — the cause split by count — shipped in the human `graph` report. What remains is per-node attribution, which feeds four surfaces including the generated `SKILL.md`'s byte contract, and needs a shape decision before any code | [Accepted behaviors](../accepted-behaviors.md), [Context graph](../../guide/context-graph.md#graph) |
