// Regenerate all metadata-derived artifacts from the single rule-metadata source (R6):
// the shipped config schema (packages/cli/schema.json) and the README rule table.
// Run after building core: `npm run build && npm run generate:docs`.
//
// Imports the built @wastech-mdlint/core (workspace symlink → packages/core/dist), so the bytes
// written here are identical to what the sync tests regenerate from source.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateConfigSchema, generateRuleDocs } from "@wastech-mdlint/core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = path.join(repoRoot, "packages", "cli", "schema.json");
writeFileSync(schemaPath, generateConfigSchema(), "utf8");

const readmePath = path.join(repoRoot, "README.md");
const readme = readFileSync(readmePath, "utf8");
const updated = readme.replace(
  /(<!-- BEGIN GENERATED RULES -->)[\s\S]*?(<!-- END GENERATED RULES -->)/,
  `$1\n${generateRuleDocs()}\n$2`
);
writeFileSync(readmePath, updated, "utf8");

process.stdout.write("Wrote packages/cli/schema.json and README.md rule table\n");
