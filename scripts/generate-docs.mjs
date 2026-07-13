// Regenerate all metadata-derived artifacts from their single sources of truth:
// the shipped config schema (packages/cli/schema.json), the README rule table (R6), and the
// README MCP tool inventory (P7 M3, introspected from the live tool registration).
// Run after building: `npm run build && npm run generate:docs`.
//
// Imports the built @wastech-mdlint/core (workspace symlink → packages/core/dist) and the built
// mcp-server dist, so the bytes written here are identical to what the sync tests regenerate.
//
// mcp-server is imported by relative path into its built dist rather than by package name: its
// package.json is bin-only (no `exports`/`main`), by design — it's a host you run, not a library.
// Adding an export solely for this one internal dev script would needlessly widen its npm surface,
// so this mirrors how the script already reaches packages/cli/schema.json by relative path.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateConfigSchema, generateRuleDocs } from "@wastech-mdlint/core";

import { generateToolInventory } from "../packages/mcp-server/dist/tool-docs.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = path.join(repoRoot, "packages", "cli", "schema.json");
writeFileSync(schemaPath, generateConfigSchema(), "utf8");

const readmePath = path.join(repoRoot, "README.md");
const readme = readFileSync(readmePath, "utf8");
const withRules = readme.replace(
  /(<!-- BEGIN GENERATED RULES -->)[\s\S]*?(<!-- END GENERATED RULES -->)/,
  `$1\n${generateRuleDocs()}\n$2`
);
const updated = withRules.replace(
  /(<!-- BEGIN GENERATED MCP TOOLS -->)[\s\S]*?(<!-- END GENERATED MCP TOOLS -->)/,
  `$1\n${await generateToolInventory()}\n$2`
);
writeFileSync(readmePath, updated, "utf8");

process.stdout.write(
  "Wrote packages/cli/schema.json and README.md (rule table + MCP tool inventory)\n"
);
