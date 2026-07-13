import type { CompileConfig, CustomRuleConfigEntry, RuleConfigEntry } from "../config/config-schema.js";
import type { ToolErrorCode } from "../errors.js";
import type { LoadedConfiguration } from "../config/load-config.js";
import { ruleRegistry } from "../engine/rules/index.js";
import { estimateTokens } from "../engine/tokens.js";
import { matchesConfigGlob } from "../discovery/globs.js";
import type { ContextGraph } from "../graph/context-graph-types.js";
import { loadContext } from "../graph/load-context.js";
import { query } from "../graph/query.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { canonicalizeRuleId } from "../rule-id.js";
import { describeRules } from "./describe-rules.js";
import { extractDocProfile } from "./doc-profile.js";
import { analyzeGraph, DEFAULT_HUB_MIN_IN_DEGREE } from "./graph-analysis.js";
import {
  synthesize,
  type CompileBudget,
  type CompileBudgetEntrypoint,
  type CompileCommandPreset,
  type CompileResult,
  type CompileSections
} from "./synthesize.js";

// P5.04 orchestration: the entry point both the CLI (P5.05) and MCP (P7.04) call. Reuses
// `loadContext`/`analyzeGraph`/`extractDocProfile`/`describeRules`/`query`/`estimateTokens` — no
// parallel parsing, graph traversal, or token-estimation logic lives here.

// Thrown when `config.compile` is absent. Mirrors `ImpactAnalysisError`'s hint-carrying pattern so
// a host can catch this type specifically: the CLI (P5.05) maps it to exit 2, the MCP tool (P7.04)
// maps it to `{ code, message, hint }`.
export class CompileConfigMissingError extends Error {
  readonly code: ToolErrorCode = "COMPILE_CONFIG_MISSING";
  readonly hint: string;

  constructor() {
    const hint = 'Add a "compile" section to the config with at least "compile.skill.name" and "compile.skill.description".';
    super(`Cannot compile a SKILL.md: config.compile is missing. ${hint}`);
    this.name = "CompileConfigMissingError";
    this.hint = hint;
  }
}

type ResolvedCompileSettings = {
  skill: { name: string; description: string };
  sections: CompileSections;
  commandPreset: CompileCommandPreset;
  hubMinInDegree: number;
};

// `config-schema.ts`'s strict `compileConfigSchema` already validated presence and shape of every
// leaf (P5.05), so only *absent* optional leaves need a default here — no more per-leaf `safeParse`
// defaulting. `outdir` still isn't read here — that stays the CLI's job.
function resolveCompileSettings(compileConfig: CompileConfig): ResolvedCompileSettings {
  return {
    skill: compileConfig.skill,
    sections: {
      architecture: compileConfig.sections?.architecture ?? true,
      rules: compileConfig.sections?.rules ?? true,
      dependencies: compileConfig.sections?.dependencies ?? true,
      workflow: compileConfig.sections?.workflow ?? true
    },
    commandPreset: compileConfig.commandPreset ?? "generic",
    hubMinInDegree: compileConfig.hubMinInDegree ?? DEFAULT_HUB_MIN_IN_DEGREE
  };
}

function isCustomRuleEntry(entry: RuleConfigEntry | CustomRuleConfigEntry): entry is CustomRuleConfigEntry {
  return entry.rule === "custom";
}

type ActiveLlm001Entry = { entrypoints: string[]; maxTokensPerEntrypoint: number };

// S6: reuses LLM-001's own options schema (so budget options are validated exactly the way
// `resolveRule` validates them) and the shared graph traversal (`query`, edgeTypes: ["import"])
// instead of re-exporting `llm.ts`'s internal eager-import walk or writing a second BFS.
function computeBudget(
  rules: readonly (RuleConfigEntry | CustomRuleConfigEntry)[],
  documents: Map<string, ParsedDocument>,
  graph: ContextGraph
): CompileBudget {
  let corpusTokenEstimate = 0;
  for (const document of documents.values()) {
    corpusTokenEstimate += estimateTokens(document.content);
  }

  const llm001Metadata = ruleRegistry.getMetadata("LLM-001");
  if (llm001Metadata === undefined) {
    throw new Error('Cannot compute the context budget: "LLM-001" metadata is missing from the registry.');
  }

  // Collect every active entry first (not a first-match dedupe): `rules[]` may configure LLM-001
  // more than once, and the engine evaluates every entry independently, so a later, stricter entry
  // for the same file must not be silently shadowed by an earlier, looser one.
  const activeEntries: ActiveLlm001Entry[] = [];
  let llm001Enabled = false;

  for (const entry of rules) {
    if (isCustomRuleEntry(entry) || canonicalizeRuleId(entry.rule) !== "LLM-001" || entry.severity === "off") {
      continue;
    }
    llm001Enabled = true;

    const parsedOptions = llm001Metadata.optionsSchema.safeParse(entry.options ?? {});
    if (!parsedOptions.success) {
      continue;
    }
    activeEntries.push(parsedOptions.data as ActiveLlm001Entry);
  }

  const sortedDocumentPaths = [...documents.keys()].sort((left, right) => left.localeCompare(right));
  const overBudget: CompileBudgetEntrypoint[] = [];
  let entrypointsMatched = 0;

  for (const entrypoint of sortedDocumentPaths) {
    // The strictest (lowest) threshold among every active entry whose `entrypoints` glob matches
    // this file — one rendered row per path, but a violation of *any* configured entry's budget.
    let strictestMaxTokens: number | undefined;
    for (const activeEntry of activeEntries) {
      if (!matchesConfigGlob(entrypoint, activeEntry.entrypoints)) {
        continue;
      }
      if (strictestMaxTokens === undefined || activeEntry.maxTokensPerEntrypoint < strictestMaxTokens) {
        strictestMaxTokens = activeEntry.maxTokensPerEntrypoint;
      }
    }
    if (strictestMaxTokens === undefined) {
      continue;
    }
    entrypointsMatched += 1;

    let totalTokens = estimateTokens(documents.get(entrypoint)!.content);
    const reached = query(graph, { start: entrypoint, direction: "forward", edgeTypes: ["import"] });
    for (const visit of reached.visited) {
      if (visit.depth === 0) {
        continue;
      }
      totalTokens += estimateTokens(documents.get(visit.path)?.content ?? "");
    }

    if (totalTokens > strictestMaxTokens) {
      overBudget.push({ path: entrypoint, totalTokens, maxTokens: strictestMaxTokens });
    }
  }

  overBudget.sort((left, right) => left.path.localeCompare(right.path));

  return { corpusTokenEstimate, llm001Enabled, entrypointsMatched, entrypointsOverBudget: overBudget };
}

// The doc's illustrative signature (`compileContext(config, cwd): CompileResult`) is shorthand, not
// literal: building a `CompileResult` requires `loadContext`, which is async, and every comparable
// core entry point (`lintFiles`, `loadConfiguration`) is already async — so this one is too.
export async function compileContext(config: LoadedConfiguration, cwd: string): Promise<CompileResult> {
  if (config.config.compile === undefined) {
    throw new CompileConfigMissingError();
  }

  const { skill, sections, commandPreset, hubMinInDegree } = resolveCompileSettings(config.config.compile);

  const { documents, graph } = await loadContext({
    cwd,
    config: config.config,
    settings: config.settings
  });
  const analysis = analyzeGraph(graph, { hubMinInDegree });

  const documentPaths = [...documents.keys()].sort((left, right) => left.localeCompare(right));
  const profiles = new Map(
    documentPaths.map((documentPath) => [
      documentPath,
      extractDocProfile(documents.get(documentPath)!, graph, { hubMinInDegree })
    ])
  );

  const configuredRules = config.config.rules ?? [];
  const ruleGroups = describeRules(configuredRules, ruleRegistry);
  const budget = computeBudget(configuredRules, documents, graph);

  return synthesize({ skill, sections, commandPreset, documentPaths, profiles, analysis, ruleGroups, budget });
}
