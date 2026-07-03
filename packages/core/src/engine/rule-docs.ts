import { ruleRegistry } from "./rules/index.js";

// Generated README rule table (R6 / P3.09). One metadata source drives the registry, schema.json,
// AND this table — so docs never drift. Includes the per-rule fixable column (audit 4.2), whose
// `yes` set is exactly the deterministic-fixable subset (SEC-001 scaffold, TBL-002 empty→TODO).
export function generateRuleDocs(): string {
  const header = "| Rule | Category | Default severity | Scope | Fixable | Description |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const rows = ruleRegistry.getAllMetadata().map((metadata) => {
    const fixable = metadata.fixable ? "yes" : "no";
    return `| \`${metadata.id}\` | ${metadata.category} | ${metadata.defaultSeverity} | ${metadata.scope} | ${fixable} | ${metadata.description} |`;
  });

  return [header, divider, ...rows].join("\n");
}
