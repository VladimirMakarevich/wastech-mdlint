import type { z } from "zod";

import type { ConfigIssue } from "../engine/registry.js";
import { ruleEntryBranchIndex } from "./config-schema.js";

/**
 * The one place a config validation issue becomes user-visible text (P13.06 / C7).
 *
 * Both validation stages render through `formatConfigIssue`, so `config.rules[0].severity` is the
 * single notation the product speaks — the loader used to emit `config.rules.0` from stage 1 and
 * `rules[1].options` from stage 2 for the same array.
 *
 * It sits in the config layer rather than in `engine/` because stage 2 (per-rule options) has no
 * union in any shipped options schema, so only config's own root schema needs the expansion below;
 * lifting it would be an abstraction ahead of a second caller.
 */

// Walk the raw (JSONC-parsed) config to the value an issue points at. Zod v4 strips `input` from
// public issues unless `reportInput` is enabled, so the raw document is the only way to see what the
// user actually wrote at a path.
function valueAt(root: unknown, issuePath: readonly PropertyKey[]): unknown {
  let current = root;
  for (const segment of issuePath) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

// A `rules[]` entry is the only place the root schema puts a union whose branches both describe a
// whole user-authored object, and the only place there is a discriminator worth consulting.
function isRuleEntryPath(issuePath: readonly PropertyKey[]): boolean {
  return (
    issuePath.length === 2 &&
    issuePath[0] === "rules" &&
    typeof issuePath[1] === "number"
  );
}

/**
 * Pick the branch whose issues describe what the user meant.
 *
 * For a `rules[]` entry that is `rule: "custom"` vs everything else. Anywhere else the schema offers
 * no discriminator, so the closest match by issue count is the best available guess — and it is a
 * guess with a floor, since every branch's issues describe the same input.
 */
function selectBranch(
  branches: readonly (readonly z.core.$ZodIssue[])[],
  issuePath: readonly PropertyKey[],
  root: unknown,
): readonly z.core.$ZodIssue[] {
  if (isRuleEntryPath(issuePath)) {
    return branches[ruleEntryBranchIndex(valueAt(root, issuePath))] ?? [];
  }

  return branches.reduce((best, branch) =>
    branch.length < best.length ? branch : best,
  );
}

function collect(
  issues: readonly z.core.$ZodIssue[],
  root: unknown,
  // Absolute path of the container these issues were reported against. Branch issues carry paths
  // relative to the union, so re-anchoring here is what keeps a nested union's discriminator lookup
  // (and the rendered path) pointing at the right node of the raw document.
  prefix: readonly PropertyKey[],
  out: ConfigIssue[],
): void {
  for (const issue of issues) {
    const issuePath = [...prefix, ...issue.path];

    // `errors: []` is the discriminated-union no-match case (`assertionSchema`'s `kind`), whose own
    // message already lists the allowed values — there is nothing to expand.
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      collect(
        selectBranch(issue.errors, issuePath, root),
        root,
        issuePath,
        out,
      );
      continue;
    }

    out.push({ path: issuePath, message: issue.message });
  }
}

/**
 * Flatten Zod's issue tree into path-anchored config issues, expanding `invalid_union` instead of
 * discarding its per-branch detail.
 *
 * Before this, a union failure rendered as its own top-level message — `Invalid input` — which named
 * neither the offending key nor the allowed values, and covered every rule family: `severity` is a
 * strict enum and `ruleEntrySchema` is `.strict()`, so `"severity": "warn"` or any unknown key on any
 * rule entry failed both branches and collapsed.
 *
 * `root` is the raw parsed config, used only to discriminate union branches (see `valueAt`).
 */
export function flattenConfigIssues(
  issues: readonly z.core.$ZodIssue[],
  root: unknown,
): ConfigIssue[] {
  const flattened: ConfigIssue[] = [];
  collect(issues, root, [], flattened);
  return flattened;
}

/**
 * Render one issue as a diagnostic line: `- config.rules[0].options.assert: <message>`.
 *
 * `.key` for object keys, `[n]` for array indices, rooted at `config` — the notation stated in
 * `docs/guide/configuration.md`.
 */
export function formatConfigIssue(issue: ConfigIssue): string {
  const location = issue.path.reduce<string>(
    (rendered, segment) =>
      typeof segment === "number"
        ? `${rendered}[${segment}]`
        : `${rendered}.${String(segment)}`,
    "config",
  );

  return `- ${location}: ${issue.message}`;
}
