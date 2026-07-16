Verify the proposed threats against the code at `{repo}` before the report is written. The threats you
are evaluating are the output of the preceding threat_analysis stage; this audit's artifacts for the task
accumulate under `{repo}/.worc/security-reports/{task_id}/`. Judge whether each threat is **real and
reachable** in **wastech-mdlint** as it actually ships, or a false positive.

For this local-first analyzer, a proposed threat usually claims that untrusted input — a config value,
an MCP tool argument, a document path, a dependency — reaches a dangerous sink. Verify **both** sides
against `{repo}`:

- The **code** side: open the cited `packages/**` (or `src/**`) `path:line` and confirm the sink is
  really there and reachable along the path the threat describes — not already guarded by a validation,
  a `normalizeRelativePath`, or a Zod schema the threat overlooked.
- The **model** side: confirm the threat respects the declared posture in `{repo}/.agents/rules/security.md`.
  A claim that an out-of-scope surface (a remote `$schema`, runtime-TS/`.cjs`/`.mjs` config, a Tier-2
  code-plugin loader, a mutating or HTTP/SSE MCP tool, an install-time write) **exists** is a real
  finding only if that code is actually present; a claim that such a thing merely *ought* to be hardened
  when it does not exist is a false positive.

{?checks_path}Cross-check any dependency-related threat against the scan advisories at {checks_path}:
confirm the vulnerable code path is one this product actually calls before treating the advisory as a
real finding.{/checks_path}

Watch for: severity inflated beyond a reachable, attacker-controlled trigger; a "vulnerability" that is
theoretical with no input an attacker controls in the local-first model; a dependency advisory whose
vulnerable code path this product never calls; and a suspected issue presented as confirmed.

Read only; do not edit. This is a **non-blocking** pass and a **fail-closed evaluator**: you must return
the findings result required by the output schema — a prose-only "looks fine" does not satisfy the
contract and hard-stops the task. Record a finding of severity **medium or high** for any threat that is
unconfirmed, misclassified, or a false positive; that routes the batch back to threat_analysis for
bounded rework. When your remaining concerns are exhausted or the rework budget is spent, accept so the
report can be written, and record any residual doubt as a finding rather than blocking. You may use the
granted network access only to confirm an upstream advisory detail.
