import { z } from "zod";

import type { CustomRuleConfigEntry, RuleConfigEntry } from "../config/config-schema.js";
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
  readonly code = "COMPILE_CONFIG_MISSING";
  readonly hint: string;

  constructor() {
    const hint = 'Add a "compile" section to the config with at least "compile.skill.name" and "compile.skill.description".';
    super(`Cannot compile a SKILL.md: config.compile is missing. ${hint}`);
    this.name = "CompileConfigMissingError";
    this.hint = hint;
  }
}

// Deliberately lenient, unexported reader for `config.compile`. The root config schema
// (`config-schema.ts`) still types `compile` as `z.unknown()` — its strict shape lands in P5.05 —
// so this local shape mirrors what P5.05 will formalize (`{ outdir?, skill: { name, description },
// sections?, commandPreset?, hubMinInDegree? }`) but only ever *defaults* missing or malformed
// pieces. It must never become a second "authoritative" schema; P5.05 supersedes it outright.
//
// Every leaf field is parsed independently, all the way down (audit finding): a bad
// `compile.skill.description` must not also drop a valid `compile.skill.name`, and a bad
// `compile.sections.rules` must not reset every other `compile.sections.*` flag to its default.
// Parsing a nested object as one `safeParse` fails all-or-nothing, so each leaf gets its own
// `safeParse` against a primitive schema instead. `outdir` isn't read here — P5.05's CLI reads it
// directly — so it isn't validated by this resolver.
const compileCommandPresetSchema = z.enum(["claude", "generic", "none"]);
const stringSchema = z.string();
const booleanSchema = z.boolean();
// A degree threshold below 1 (or fractional) is malformed, not just "unusual" — `0`/negative would
// make `classifyNode`'s `inDegree >= hubMinInDegree` check trivially true for almost every node
// (audit finding), silently rewriting role classification instead of defaulting like every other
// malformed field here.
const hubMinInDegreeSchema = z.number().int().min(1);

type ResolvedCompileSettings = {
  skill: { name: string; description: string };
  sections: CompileSections;
  commandPreset: CompileCommandPreset;
  hubMinInDegree: number;
};

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback: string): string {
  const parsed = stringSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  const parsed = booleanSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function resolveCompileSettings(raw: unknown): ResolvedCompileSettings {
  const record = asRecord(raw);
  const skillRecord = asRecord(record.skill);
  const sectionsRecord = asRecord(record.sections);

  const commandPreset = compileCommandPresetSchema.safeParse(record.commandPreset);
  const hubMinInDegree = hubMinInDegreeSchema.safeParse(record.hubMinInDegree);

  return {
    skill: {
      name: readString(skillRecord.name, ""),
      description: readString(skillRecord.description, "")
    },
    sections: {
      architecture: readBoolean(sectionsRecord.architecture, true),
      rules: readBoolean(sectionsRecord.rules, true),
      dependencies: readBoolean(sectionsRecord.dependencies, true),
      workflow: readBoolean(sectionsRecord.workflow, true)
    },
    commandPreset: commandPreset.success ? commandPreset.data : "generic",
    hubMinInDegree: hubMinInDegree.success ? hubMinInDegree.data : DEFAULT_HUB_MIN_IN_DEGREE
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
