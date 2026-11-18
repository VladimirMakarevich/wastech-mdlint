import { ruleRegistry } from "./rules/index.js";

// Generated README rule table. One metadata source drives the registry, schema.json,
// AND this table — so docs never drift. Includes the per-rule fixable column, whose
// `yes` set is exactly the rules whose metadata declares a deterministic `--fix`.
export function generateRuleDocs(): string {
  const header =
    "| Rule | Alias | Category | Default severity | Scope | Fixable | Description |";
  const divider = "| --- | --- | --- | --- | --- | --- | --- |";
  const rows = ruleRegistry.getAllMetadata().map((metadata) => {
    const fixable = metadata.fixable ? "yes" : "no";
    // The generator is the second reader of `docsUrl` — it previously had none — so the table's
    // link and a finding's `helpUri` cannot point at different pages. No `Docs` column: linking the
    // id is enough, and every added column shifts the positions `docs-sync.test.ts` reads by index.
    // The shipped fix skill reads the `Fixable` column by its header name, so an inserted column
    // such as `Alias` does not disturb it. `defineRule` always fills `docsUrl`, so the
    // bare-code-span fallback is unreachable for a built-in; it exists because the field is optional
    // on the type.
    const rule =
      metadata.docsUrl === undefined
        ? `\`${metadata.id}\``
        : `[\`${metadata.id}\`](${metadata.docsUrl})`;
    return `| ${rule} | \`${metadata.alias}\` | ${metadata.category} | ${metadata.defaultSeverity} | ${metadata.scope} | ${fixable} | ${metadata.description} |`;
  });

  return [header, divider, ...rows].join("\n");
}
