import { z } from "zod";

import { linkResolves } from "../primitives/reference.js";
import { defineRule, type RuleDefinition } from "../registry.js";

// Shared site-router option shape (C5): a rule may override the inherited `settings.siteRouter`.
const siteRouterOptionSchema = z
  .object({
    preset: z.string().optional(),
    contentDir: z.string().optional(),
    defaultLocale: z.string().optional()
  })
  .strict();

// REF-001 — relative links resolve to a real file (P2.07 proof rule; the rest of REF lands in
// P3.04). `exclude` is a link-*target* filter (matches the config example), not file scoping.
export const ref001: RuleDefinition = defineRule({
  metadata: {
    id: "REF-001",
    category: "REF",
    description: "Relative links resolve to a file.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z
    .object({
      exclude: z.array(z.string()).optional(),
      siteRouter: siteRouterOptionSchema.optional()
    })
    .strict(),
  check: (options) => (context) => {
    const findings = linkResolves(
      context.document!,
      { documents: context.documents!, rootDir: context.rootDir!, settings: context.settings },
      { exclude: options.exclude, siteRouter: options.siteRouter }
    );

    for (const finding of findings) {
      context.report({ ...finding, helpUri: "REF-001" });
    }
  }
});
