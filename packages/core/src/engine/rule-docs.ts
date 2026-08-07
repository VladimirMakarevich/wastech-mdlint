import { ruleRegistry } from "./rules/index.js";

// Generated README rule table. One metadata source drives the registry, schema.json,
// AND this table — so docs never drift. Includes the per-rule fixable column, whose
// `yes` set is exactly the deterministic-fixable subset (SEC-001 scaffold, TBL-002 empty→TODO).
export function generateRuleDocs(): string {
  const header =
    "| Rule | Category | Default severity | Scope | Fixable | Description |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const rows = ruleRegistry.getAllMetadata().map((metadata) => {
    const fixable = metadata.fixable ? "yes" : "no";
    // The generator is the second reader of `docsUrl` — it previously had none — so the table's
    // link and a finding's `helpUri` cannot point at different pages. No `Docs` column: linking the
    // id keeps the column set — which `docs-sync.test.ts` and the shipped fix skill both key on —
    // unchanged. `defineRule` always fills `docsUrl`, so the bare-code-span fallback is unreachable
    // for a built-in; it exists because the field is optional on the type.
    const rule =
      metadata.docsUrl === undefined
        ? `\`${metadata.id}\``
        : `[\`${metadata.id}\`](${metadata.docsUrl})`;
    return `| ${rule} | ${metadata.category} | ${metadata.defaultSeverity} | ${metadata.scope} | ${fixable} | ${metadata.description} |`;
  });

  return [header, divider, ...rows].join("\n");
}
