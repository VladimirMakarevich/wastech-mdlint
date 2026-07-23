import { createHash } from "node:crypto";

import { compareStrings } from "../deterministic-sort.js";
import type { ContextGraphEdge } from "../graph/context-graph-types.js";
import type { DocumentProfile } from "./doc-profile.js";
import type { RuleDescriptionGroup } from "./describe-rules.js";
import type { GraphAnalysis } from "./graph-analysis.js";
import { parseSkillFrontmatter } from "../skills/skill-model.js";

// P5.04 pure renderer (S1/S2/S4/S6): assembles the final SKILL.md text from already-computed P5.01
// (`GraphAnalysis`), P5.02 (`DocumentProfile`), and P5.03 (`RuleDescriptionGroup`) data. `synthesize`
// never touches the filesystem or `cwd` — that orchestration lives in `compile-context.ts` — so this
// module stays trivially unit-testable with hand-built fixtures.

export type CompileSections = {
  architecture: boolean;
  rules: boolean;
  dependencies: boolean;
  workflow: boolean;
};

export type CompileCommandPreset = "claude" | "generic" | "none";

export type CompileBudgetEntrypoint = {
  path: string;
  totalTokens: number;
  maxTokens: number;
};

export type CompileBudget = {
  corpusTokenEstimate: number;
  // Whether at least one active (non-`off`) LLM-001 config entry exists, independent of whether
  // its `entrypoints` glob actually matched a corpus file. Keeping this separate from
  // `entrypointsMatched` is what lets `synthesize` tell "LLM-001 isn't configured at all" apart
  // from "it's configured but its glob matched nothing" (S6 honesty) — both would otherwise look
  // identical (an empty `entrypointsOverBudget` array) if `entrypointsMatched` were the only signal.
  llm001Enabled: boolean;
  // Distinct entrypoints resolved from active LLM-001 entries (post-dedup); can be 0 even when
  // `llm001Enabled` is true, e.g. a misconfigured or empty-match `entrypoints` glob.
  entrypointsMatched: number;
  entrypointsOverBudget: CompileBudgetEntrypoint[];
};

// Frozen (audit 4.4): P7 and P8 depend on this exact shape.
export interface CompileResult {
  skillContent: string;
  metadata: {
    documentCount: number;
    ruleCount: number;
    componentCount: number;
    contentHash: string;
  };
}

export type SynthesizeInput = {
  skill: { name: string; description: string };
  sections: CompileSections;
  commandPreset: CompileCommandPreset;
  documentPaths: string[];
  profiles: Map<string, DocumentProfile>;
  analysis: GraphAnalysis;
  ruleGroups: RuleDescriptionGroup[];
  budget: CompileBudget;
};

function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}

// Shared Markdown-safety helpers (audit finding): every free-form value rendered below — a
// repo-relative path, an author-supplied rule description, the configured skill name — reaches a
// Markdown control position (a heading line, a table cell, or an inline code span) verbatim unless
// normalized first. Centralizing that here keeps every render site correct on the same unusual
// inputs (a multiline value, a path containing a backtick or `|`) instead of re-deriving it per
// call site.

// Collapse embedded newlines so a multiline value can't break out of a single Markdown line (a
// heading, bullet, or table row) into unintended block content.
function toSingleLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ");
}

// A CommonMark-safe inline code span for arbitrary content: the fence is one backtick longer than
// the longest backtick run already inside the text (so the content can never prematurely close the
// span), and a padding space guards content that starts or ends with a backtick — both are
// CommonMark code-span requirements, not cosmetic choices.
function codeSpan(text: string): string {
  const singleLine = toSingleLine(text);
  const longestBacktickRun = Math.max(0, ...(singleLine.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestBacktickRun + 1);
  const needsPadding = singleLine.length === 0 || singleLine.startsWith("`") || singleLine.endsWith("`");
  return `${fence}${needsPadding ? ` ${singleLine} ` : singleLine}${fence}`;
}

// A GFM table cell is delimited by `|`; escape a literal pipe (and the backslash that would
// otherwise make that escape ambiguous) and collapse newlines so a value can't shift columns or
// split the row into a second, malformed one.
function tableCell(text: string): string {
  return toSingleLine(text).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function renderFrontmatter(skill: { name: string; description: string }): string {
  // Hand-rendered YAML (no YAML dependency): `JSON.stringify` produces a valid YAML double-quoted
  // scalar for any string, including one containing quotes or newlines.
  return `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---`;
}

function renderBudget(budget: CompileBudget): string {
  const lines = ["## Context Budget", "", `Corpus token estimate: ${budget.corpusTokenEstimate} tokens.`];

  if (!budget.llm001Enabled) {
    lines.push("No entrypoints configured (LLM-001 not enabled).");
  } else if (budget.entrypointsMatched === 0) {
    lines.push("LLM-001 is enabled, but its configured entrypoints matched no files in this corpus.");
  } else if (budget.entrypointsOverBudget.length === 0) {
    lines.push("All configured entrypoints are within budget.");
  } else {
    // Phrasing mirrors LLM-001's own report (engine/rules/llm.ts) so the same budget breach reads
    // identically whether seen as a lint finding or in the compiled skill.
    for (const entrypoint of budget.entrypointsOverBudget) {
      const percentOver = (((entrypoint.totalTokens - entrypoint.maxTokens) / entrypoint.maxTokens) * 100).toFixed(1);
      lines.push(
        `- ${codeSpan(entrypoint.path)}: ${entrypoint.totalTokens} estimated tokens exceeds ${entrypoint.maxTokens} (${percentOver}% over).`
      );
    }
  }

  return lines.join("\n");
}

// Derived-only classification (no new parsing): a document with a resolved id-table pattern is a
// reference doc; otherwise any table makes it tabular; otherwise it's narrative prose.
function classifyDocumentType(profile: DocumentProfile): "reference" | "tabular" | "narrative" {
  if (profile.idPattern !== undefined) {
    return "reference";
  }
  if (profile.tableSchemas.length > 0) {
    return "tabular";
  }
  return "narrative";
}

function renderArchitecture(documentPaths: string[], profiles: Map<string, DocumentProfile>): string {
  if (documentPaths.length === 0) {
    return ["## Document Architecture", "", "(no documents found)"].join("\n");
  }

  // A flat, fully-path-qualified table instead of a nested tree: the repo-relative path already
  // conveys structure, and a flat table is trivially deterministic to render and assert on (no
  // locked example mandates nesting).
  const rows = documentPaths.map((documentPath) => {
    const profile = profiles.get(documentPath);
    const role = profile?.role ?? "isolated";
    const type = profile === undefined ? "narrative" : classifyDocumentType(profile);
    return `| ${tableCell(documentPath)} | ${role} | ${type} |`;
  });

  return ["## Document Architecture", "", "| Path | Role | Type |", "| --- | --- | --- |", ...rows].join("\n");
}

function renderRules(ruleGroups: RuleDescriptionGroup[]): string {
  if (ruleGroups.length === 0) {
    return ["## Document Rules", "", "(no rules configured)"].join("\n");
  }

  const groupBlocks = ruleGroups.map((group) => {
    const bulletLines = group.rules.map((rule) => `- ${codeSpan(rule.id)}: ${toSingleLine(rule.description)}`);
    return [`### ${group.label} (${group.category})`, "", ...bulletLines].join("\n");
  });

  return ["## Document Rules", groupBlocks.join("\n\n")].join("\n\n");
}

function renderReadingOrderBlock(documentPaths: string[], analysis: GraphAnalysis): string {
  const lines = ["### Reading Order", ""];

  if (documentPaths.length === 0) {
    lines.push("(no documents found)");
  } else if (analysis.readingOrder.length === 0) {
    // G6 honesty: an empty reading order with a non-empty corpus means every document was cycle-
    // excluded, not that the corpus itself is empty — those are different facts and must not share
    // the same "(no documents found)" message. The Cycles block right below names them.
    lines.push(
      `(no reading order — all ${documentPaths.length} document(s) are excluded by cycles; see Cycles below)`
    );
  } else {
    analysis.readingOrder.forEach((documentPath, index) => {
      lines.push(`${index + 1}. ${codeSpan(documentPath)}`);
    });
  }

  return lines.join("\n");
}

// G6 honesty: cycle members (and anything only reachable through them) never appear in the reading
// order above, so this block names them explicitly instead of letting them vanish silently.
function renderCyclesBlock(analysis: GraphAnalysis): string {
  const lines = ["### Cycles", ""];

  for (const cycle of analysis.cycles) {
    lines.push(`- ${codeSpan(cycle.join(" -> "))}`);
  }

  const excludedText =
    analysis.excludedFromReadingOrder.length === 0
      ? "(none)"
      : analysis.excludedFromReadingOrder.map((documentPath) => codeSpan(documentPath)).join(", ");
  lines.push("", `Excluded from reading order: ${excludedText}`);

  return lines.join("\n");
}

function formatEdgeList(edges: readonly ContextGraphEdge[], endpoint: "to" | "from"): string {
  if (edges.length === 0) {
    return "(none)";
  }

  const sorted = [...edges].sort(
    (left, right) => compareStrings(left[endpoint], right[endpoint]) || compareStrings(left.type, right.type)
  );
  return sorted.map((edge) => `${codeSpan(edge[endpoint])} (${edge.type})`).join(", ");
}

function renderReferencesBlock(documentPaths: string[], profiles: Map<string, DocumentProfile>): string {
  if (documentPaths.length === 0) {
    return ["### References", "", "(no documents found)"].join("\n");
  }

  const entries = documentPaths.map((documentPath) => {
    const profile = profiles.get(documentPath);
    return [
      // A code span (not bold) — consistent with every other path in this module, and a `**`
      // sequence inside a path would otherwise prematurely close a bold span (audit finding).
      codeSpan(documentPath),
      `- to: ${formatEdgeList(profile?.referencesTo ?? [], "to")}`,
      `- from: ${formatEdgeList(profile?.referencedBy ?? [], "from")}`
    ].join("\n");
  });

  return ["### References", entries.join("\n\n")].join("\n\n");
}

// Locked verbatim (audit 3.4) — copy exactly; presets change only this block, never the computed
// data above it (S2/S4).
function renderCommandBlock(commandPreset: CompileCommandPreset): string | undefined {
  if (commandPreset === "none") {
    return undefined;
  }

  if (commandPreset === "claude") {
    return [
      "### Working with dependencies",
      "",
      "- Trace what a change affects:",
      "",
      "  !npx wastech-mdlint impact $ARGUMENTS",
      "",
      "- Pull the context slice for a topic:",
      "",
      "  !npx wastech-mdlint slice $ARGUMENTS"
    ].join("\n");
  }

  return [
    "### Working with dependencies",
    "",
    "- Trace what a change affects: run `wastech-mdlint impact <file>`, or call the",
    '  `impact-analysis` MCP tool with `{ "file": "<file>" }`.',
    "- Pull the context slice for a topic: run `wastech-mdlint slice <query>`, or call the",
    '  `context-slice` MCP tool with `{ "query": "<query>" }`.'
  ].join("\n");
}

function renderDependencies(
  documentPaths: string[],
  profiles: Map<string, DocumentProfile>,
  analysis: GraphAnalysis,
  commandPreset: CompileCommandPreset
): string {
  const blocks = [renderReadingOrderBlock(documentPaths, analysis)];

  if (analysis.cycles.length > 0) {
    blocks.push(renderCyclesBlock(analysis));
  }

  blocks.push(renderReferencesBlock(documentPaths, profiles));

  const commandBlock = renderCommandBlock(commandPreset);
  if (commandBlock !== undefined) {
    blocks.push(commandBlock);
  }

  return ["## Document Dependencies", ...blocks].join("\n\n");
}

// Fixed boilerplate (S3 skipped — English scaffold only); wording is not locked by any audit
// example, so it is not corpus-derived. Steps are still gated by `sections`, though: a step that
// named a disabled section would make the generated SKILL.md self-contradictory, pointing readers
// at a heading that isn't there.
function renderWorkflow(sections: CompileSections): string {
  const steps: string[] = [];

  if (sections.architecture) {
    steps.push("Start from Document Architecture to find the right entry point for your change.");
  }
  if (sections.rules) {
    steps.push("Check Document Rules for the constraints that apply to the files you plan to touch.");
  }
  if (sections.dependencies) {
    steps.push(
      "Read Document Dependencies to trace what a change affects, and follow the reading order before editing."
    );
  }
  // Context Budget is never gated by `sections` (S6), so this step is always valid to reference.
  steps.push("Mind the Context Budget so your edits do not push an eager-imported entrypoint over its token limit.");

  return ["## Workflow", "", ...steps.map((step, index) => `${index + 1}. ${step}`)].join("\n");
}

export function synthesize(input: SynthesizeInput): CompileResult {
  // Validate before rendering (S1): an empty `skill.name`/`skill.description` throws a ZodError
  // here rather than silently emitting invalid frontmatter. `compile-context.ts`'s lenient reader
  // defaults missing fields to `""`, so this is the one place that actually enforces S1 today —
  // P5.05 replaces it with a proper load-time diagnostic.
  parseSkillFrontmatter({ name: input.skill.name, description: input.skill.description });

  const frontmatter = renderFrontmatter(input.skill);
  // Single-lined (unlike the frontmatter, which safely embeds a raw multiline name inside a YAML
  // double-quoted scalar via JSON.stringify): a heading is one Markdown line, and a bare newline in
  // `skill.name` would otherwise end the heading early and inject the rest as loose paragraph text.
  const title = `# ${toSingleLine(input.skill.name)}`;
  const budgetSection = renderBudget(input.budget);
  const architectureSection = input.sections.architecture
    ? renderArchitecture(input.documentPaths, input.profiles)
    : undefined;
  const rulesSection = input.sections.rules ? renderRules(input.ruleGroups) : undefined;
  const dependenciesSection = input.sections.dependencies
    ? renderDependencies(input.documentPaths, input.profiles, input.analysis, input.commandPreset)
    : undefined;
  const workflowSection = input.sections.workflow ? renderWorkflow(input.sections) : undefined;

  const documentCount = input.documentPaths.length;
  const ruleCount = input.ruleGroups.reduce((total, group) => total + group.rules.length, 0);
  const componentCount = input.analysis.components.length;

  // Hash the provenance line's deterministic text too, not just the gated sections — a gated-off
  // section's own `documentCount`/`ruleCount` still change the *visible* provenance text even when
  // that section itself doesn't contribute to the hash, so excluding provenance entirely let two
  // different `skillContent` bodies share one `contentHash` (S4 violation). Only the hash token
  // itself is excluded (via a placeholder), since embedding the real hash would be circular.
  const renderProvenance = (hash: string): string =>
    `Generated from ${documentCount} docs, ${ruleCount} rules · content hash sha256:${hash}`;

  const hashedParts = [
    frontmatter,
    title,
    renderProvenance("<pending>"),
    budgetSection,
    architectureSection,
    rulesSection,
    dependenciesSection,
    workflowSection
  ].filter(isDefined);
  const contentHash = createHash("sha256").update(hashedParts.join("\n\n")).digest("hex").slice(0, 16);

  const provenance = renderProvenance(contentHash);

  const parts = [
    frontmatter,
    title,
    provenance,
    budgetSection,
    architectureSection,
    rulesSection,
    dependenciesSection,
    workflowSection
  ].filter(isDefined);

  return {
    skillContent: `${parts.join("\n\n")}\n`,
    metadata: { documentCount, ruleCount, componentCount, contentHash }
  };
}
