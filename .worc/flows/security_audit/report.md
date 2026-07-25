Produce the security-audit report for **wastech-mdlint** as your structured output — you write no files.

## What to write

Draw on the verified threats and the verifier's verdicts:{?threat_analysis_path} the proposed threats at {threat_analysis_path},{/threat_analysis_path}{?review_path} the verification findings at {review_path} (which threats were confirmed, misclassified, or dismissed),{/review_path}{?checks_path} and the dependency-scan advisories at {checks_path}.{/checks_path} Report only what verification confirmed; carry nothing the verifier rejected into the confirmed set.

For each **verified** finding cover: the location as `path:line` (or the dependency + advisory id), the
severity, whether it is **exploitable or theoretical** (with the concrete trigger for an exploitable
one), the impact, and a concrete remediation that fits this product's local-first, no-code-execution
posture and points at where the fix belongs. Order findings by severity. Use the glossary's exact terms
(`docs/mdlint_v2/glossary.md`). Keep a separate section for threats **dismissed as false positives**,
each with the reason, so a reader sees what was considered and cleared. If nothing was confirmed, say so
plainly — an empty confirmed set is a valid, honest result, not a gap to pad.

Keep the report deterministic and bounded to the analyzed repository state; do not dump secrets,
environment variables, or unrelated local filesystem data into it.

Return the whole report as the `content` field of the structured output. The orchestrator writes it to the
private report directory for you — you are a read-only node and must not create or modify any file.
