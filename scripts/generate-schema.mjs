// Regenerate the shipped config schema (packages/cli/schema.json) from the single rule-metadata
// source (P2.06 / R6). Run after building core: `npm run build && npm run generate:schema`.
//
// Imports the built @wastech-mdlint/core (resolved via the workspace symlink to packages/core/dist),
// so the bytes written here are identical to what the sync test regenerates from source.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateConfigSchema } from "@wastech-mdlint/core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repoRoot, "packages", "cli", "schema.json");

writeFileSync(target, generateConfigSchema(), "utf8");
process.stdout.write(`Wrote ${path.relative(repoRoot, target)}\n`);
