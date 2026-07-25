Verify the report at `{repo}/docs/research/{task_id}/report.md` against its evidence. The deterministic
citation check has already confirmed that cited locations exist; your job is to judge whether each claim
is actually **supported** by what it cites and whether the conclusions follow.

For this **wastech-mdlint** full-solution audit, a finding asserts a business/logic defect, a technical
problem, an omission/gap, or a shortcoming — usually that shipped code is wrong, weak, or missing against
a documented or implied standard. Verify *both* sides against `{repo}`:

- The **code** side: open the cited `packages/**` (or `src/**`) `path:line` and confirm it really says
  what the finding claims, in the way the finding claims.
- The **standard** side: when the finding measures code against a requirement, decision, architecture
  invariant, glossary/guide claim, or phase exit criterion under `docs/mdlint_v2/` (or `docs/guide/`),
  open the cited clause and confirm the standard is stated there and read correctly — not paraphrased into
  something stronger than what is written.

Watch for: severity inflated beyond what the evidence supports; a wrong **category** (e.g. a mere
shortcoming reported as a business/logic defect); a "gap" that a later phase or a task file's recorded
deferral actually closes or intentionally scopes out (per the precedence order — specific task file >
requirement > decision > roadmap); and a suspected issue presented as confirmed.

Read only; do not edit. Return findings in the output schema — a finding of severity medium or high
marks a claim that is unsupported, misstated, or misclassified. This is a non-blocking pass: if you
cannot resolve a concern, record it as a finding rather than blocking the deliverable.
