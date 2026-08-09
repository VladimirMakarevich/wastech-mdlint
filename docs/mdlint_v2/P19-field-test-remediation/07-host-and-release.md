# P19.07 — One host contract key, and the lockfile

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.
>
> Closes [F-14](../field-test-2026-08-09-debates.md#f-14--the-two-hosts-name-the-impact-records-subject-differently) and [F-01](../field-test-2026-08-09-debates.md#f-01--the-committed-lockfile-pins-an-sdk-with-open-advisories-while-consumers-resolve-clean).

## Goal

Make the impact record the same record on both hosts, and stop developing against dependency versions no user receives.

## Sequence

- **Previous:** — · **Next:** —.
- **Depends on:** — · **Blocks:** —.

## Problem

**F-14 — the two hosts name the impact record's subject differently.** MCP `impact-analysis` returns `file`; the CLI's `impact --format json` returns `changedFile`. [Output & exit codes](../../guide/output.md) states the CLI returns "the same record MCP returns, under a `lint` key, narrowed to the affected subgraph". The `lint` half is a real and documented difference in capability. The rename is the part nothing accounts for, and a client generated from the MCP `outputSchema` will not find `file` in the CLI's JSON.

It is worth fixing precisely because everything else about these two hosts lines up to the byte: the field test compared 459 lint messages key by key, an identical graph document field by field, and a compiled skill identical across 46 397 characters. One key name is the only thing between "the same record" and a claim that is simply true.

**F-01 — the committed lockfile pins an SDK with open advisories, while consumers resolve clean.** `npm ci && npm audit --omit=dev` reports five production-tree advisories (2 high, 3 moderate), all through `@modelcontextprotocol/sdk@1.29.0` — the top of the vulnerable range. Installing the packed artifacts elsewhere resolves the declared `^1.29.0` to `1.30.0` and audits zero.

So the claim to avoid is "we ship vulnerable dependencies", which is false. What is true: CI runs `npm ci`, so every test, every packed artifact and every contributor's machine exercises versions no user gets. The published range already admits the fix.

## Deliverables / steps

1. **Pick a side for the impact record's subject key** and make the other match, or correct the sentence in the output guide if the divergence is deliberate. Whichever way, the two hosts and the document that describes them agree afterwards.
2. **Bump the lockfile** (`npm update @modelcontextprotocol/sdk`) and commit it. No manifest change is needed.
3. **Decide whether the production-tree audit belongs in a gate.** The field test found this because it split `npm audit` from `npm audit --omit=dev`; nothing in CI does. A gate here is a judgment call about churn — advisories appear on their own schedule — so state the decision either way rather than leaving the split as a thing only a field test performs.

## Exit criteria

- [ ] The MCP and CLI impact records use the same key for their subject, and the output guide describes what ships.
- [ ] `npm ci && npm audit --omit=dev` reports no advisory in the production tree.
- [ ] The decision on step 3 is recorded — in CI if it is taken, in the register if it is declined.
