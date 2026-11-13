import { z } from "zod";

import { compareStrings } from "../../deterministic-sort.js";
import {
  frontmatterInSet,
  frontmatterMatches,
  frontmatterRequired,
  resolveFrontmatter,
} from "../primitives/frontmatter.js";
import { regexStringSchema } from "../regex.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";

// Front matter rules.

// FM-001 — front matter is valid YAML and matches the declared required keys, allowed values and
// value patterns. With no options it still checks that the block parses and is a mapping, which is
// worth having on its own: a broken block is invisible in rendered Markdown.
//
// `patterns` maps a key to a bare regex string with no flags field, unlike `frontmatterMatches` and
// TBL-004: a flat `{ key: pattern }` record keeps the common case one line per key, and a pattern
// that needs case-insensitivity can use the inline `(?i:…)` modifier the runtime supports.
export const fm001: RuleDefinition = defineRule({
  metadata: {
    id: "FM-001",
    category: "FM",
    description:
      "Front matter is valid YAML and matches the declared keys, values and patterns.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      required: z.array(z.string().min(1)).optional(),
      allowed: z
        .record(z.string().min(1), z.array(z.string()).min(1))
        .optional(),
      patterns: z.record(z.string().min(1), regexStringSchema).optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    const document = context.document!;

    // Answered once, before any key check: every primitive below would report the same unusable
    // block, and one malformed block has to read as one finding however many keys are configured.
    const resolved = resolveFrontmatter(document);
    if (resolved.kind === "unusable") {
      context.report(resolved.finding);
      return;
    }

    const findings = [
      ...frontmatterRequired(document, { keys: options.required ?? [] }),
      // Keys iterated in code-point order so the per-document emission order does not depend on
      // the order a user happened to write their config object in.
      ...Object.keys(options.allowed ?? {})
        .sort(compareStrings)
        .flatMap((key) =>
          frontmatterInSet(document, { key, values: options.allowed![key]! }),
        ),
      ...Object.keys(options.patterns ?? {})
        .sort(compareStrings)
        .flatMap((key) =>
          frontmatterMatches(document, {
            key,
            pattern: options.patterns![key]!,
          }),
        ),
    ];
    for (const finding of findings) {
      context.report(finding);
    }
  },
});

export const FM_RULES: readonly RuleDefinition[] = [fm001];
