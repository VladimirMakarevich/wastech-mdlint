# P19.07 — One host contract key, and the lockfile

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.
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

## Outcome

**F-14. The CLI adopted `file`.** Core's `ImpactClassification` calls its subject `file`, the MCP tool passes that record through unchanged, and the CLI was the only place remapping it — one line, and the more descriptive name was not worth a spelling difference where the two hosts have no difference in meaning. Renaming the MCP field instead would have diverged from core's own type and from the tool's `file` **input** key, and reversed a decision [P7.03](../P7-mcp-server/03-graph-tools.md) states explicitly. Nothing is published (every package is `0.0.0` and the name 404s on the registry), so no consumer broke.

The hand-authored impact skill's field table no longer needs a per-host column for the subject: it now states that the CLI adds a `lint` field and that every other field is named and shaped identically, so code written against one host reads the other.

The structural half matters more than the rename. `packages/mcp-server/test/host-parity.test.ts` compared lint and graph and **not** impact — which is exactly why the divergence survived to a field test, since each host's own suite passed while asserting its own key. It now spawns `impact --format json`, calls `impact-analysis` on the same fixture, and asserts the CLI payload minus `lint` deep-equals the MCP `structuredContent`, key set included. Restoring `changedFile` fails it with the two records printed side by side.

The output guide's sentence was the other half of the finding, and it was ambiguous rather than wrong: read in its table the "same record MCP returns" is the **lint** record, which is what the `lint` key holds. It now says that unambiguously, and states separately that the impact record itself is identical on both hosts.

**F-01. Bumped, and gated.** `@modelcontextprotocol/sdk` moved `1.29.0` → `1.30.0` in the lockfile, with no manifest change — the declared `^1.29.0` already admitted it. The bump alone left four of the five advisories in place, because updating one entry does not re-resolve the subtree beneath it; `@hono/node-server`, `hono`, `fast-uri` and `ip-address` were updated to their own current in-range versions in the same pass. `npm ci && npm audit --omit=dev` now reports **0** where it reported 5 (2 high, 3 moderate). The workspace-wide audit still reports 5, all in the dev chain, which is the position [PR.05](../P-release/05-release-verification.md) already records and which nothing here changes.

**On step 3, the gate was taken.** `ci.yml` gains an ubuntu-only `audit` job running `npm audit --omit=dev --audit-level=high`. Two judgment calls are stated in the workflow itself: `--omit=dev`, because the dev chain ships in no tarball and a bump justified by an advisory a consumer cannot reach only moves the lockfile the matrix is pinned to; and `--audit-level=high` rather than the default, because advisories arrive on a schedule nobody here controls and a gate that reddens pull requests which changed no dependency is one people learn to route around. Moderate and low findings still print for a reader of the job log. The workflow is the record, so no register row was added.

## Exit criteria

- [x] The MCP and CLI impact records use the same key for their subject, and the output guide describes what ships.
- [x] `npm ci && npm audit --omit=dev` reports no advisory in the production tree.
- [x] The decision on step 3 is recorded — in CI if it is taken, in the register if it is declined.
