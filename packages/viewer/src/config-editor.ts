import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ElementContent } from "hast";
import { h } from "hastscript";

import {
  compareStrings,
  ConfigError,
  editConfigText,
  generateConfigSchema,
  parseConfiguration,
  ruleRegistry,
  writeFileAtomic,
  type ConfigEdit,
  type LintConfig,
  type LintMessage,
  type LoadedConfiguration,
} from "@wastech-mdlint/core";

import type { Corpus } from "./corpus.js";
import { highlight } from "./highlight.js";
import { copyPathButton } from "./page.js";

// The config page: the config as it is on disk, the rules the registry offers, a preview of what a
// changed config would report, and — only when the viewer was started to allow it — saving the
// change. Reading, validating and editing the config are core's (`parseConfiguration`,
// `editConfigText`, the generated schema); this module decides which file that is, compares a
// candidate's findings with today's, and guards the one write the viewer can make.

export type ConfigFile = {
  absolutePath: string;
  // Relative to the repository, POSIX; the absolute path never reaches a page.
  displayPath: string;
  text: string;
  // Of `text`, so a change is applied only to the version of the file the reader was looking at.
  hash: string;
};

// What a request to change the config carries: the file version it was made against, and either
// edits to that version, a whole new text, or new text plus edits on top of it — the page's text
// mode and its form can be used one after the other.
export type ChangeRequest = {
  base: string;
  text?: string;
  edits?: ConfigEdit[];
};

export type PreviewFinding = Pick<
  LintMessage,
  "filePath" | "line" | "ruleId" | "severity" | "message"
>;

export type PreviewCounts = { errors: number; warnings: number };

export type Preview =
  | { status: "invalid"; errors: string[]; text?: string }
  | {
      status: "ok";
      text: string;
      hash: string;
      // The candidate as core parsed it, for the page's form to show after a change made as text.
      config: LintConfig;
      ruleIds: (string | null)[];
      documents: { before: number; after: number };
      findings: { before: PreviewCounts; after: PreviewCounts };
      byRule: { ruleId: string; before: number; after: number }[];
      added: PreviewFinding[];
      removed: PreviewFinding[];
      addedCount: number;
      removedCount: number;
    };

// Enough to read through and act on; the counts above always cover all of them.
const LISTED_FINDINGS = 200;

// The package's schema, not a project-local one: it carries the same branch for every built-in rule
// and the generic custom-rule branch the form builds a custom rule from. Built once — it only
// changes with the installed package.
const CONFIG_SCHEMA = JSON.parse(generateConfigSchema()) as unknown;

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The config file the corpus was loaded from, read fresh from disk, or `undefined` when there is none. */
export async function readConfigFile(
  corpus: Corpus,
): Promise<ConfigFile | undefined> {
  const absolutePath = corpus.configuration.configPath;
  if (absolutePath === undefined) {
    return undefined;
  }
  const text = await readFile(absolutePath, "utf8").catch(() => undefined);
  if (text === undefined) {
    return undefined;
  }
  return {
    absolutePath,
    displayPath: path
      .relative(corpus.rootDir, absolutePath)
      .split(path.sep)
      .join("/"),
    text,
    hash: hashText(text),
  };
}

/**
 * Why saving is off, or `undefined` when it is on. Three conditions, each its own reason: the viewer
 * was not started with the flag that allows writing; there is no config file (creating one is
 * `init`'s job, which also wires the schema); or the file is outside the repository, the only tree
 * the viewer is allowed to change.
 */
export async function writeBlockedReason(
  corpus: Corpus,
  allowWrites: boolean,
): Promise<string | undefined> {
  if (!allowWrites) {
    return "Saving is off. Start the viewer with --allow-config-writes to save from this page; until then, copy or download the changed file.";
  }
  const file = await readConfigFile(corpus);
  if (file === undefined) {
    return "There is no config file to save to. Create one with wastech-mdlint init, then reload this page.";
  }
  if (!(await corpus.contains(file.absolutePath))) {
    return "The config file is outside the repository, and the viewer writes only inside it.";
  }
  return undefined;
}

export type ParsedChangeRequest =
  | { ok: true; request: ChangeRequest }
  | { ok: false; message: string };

const EDIT_OPS = new Set(["set", "remove", "insert"]);

/** Check the shape of a change request body; what the edits mean is for core to judge. */
export function parseChangeRequest(body: unknown): ParsedChangeRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const { base, text, edits, ...rest } = body as Record<string, unknown>;
  const unknownKey = Object.keys(rest)[0];
  if (unknownKey !== undefined) {
    return { ok: false, message: `Unknown field "${unknownKey}".` };
  }
  if (typeof base !== "string" || !/^[0-9a-f]{64}$/.test(base)) {
    return {
      ok: false,
      message:
        '"base" must name the version of the file the change was made to.',
    };
  }
  if (text !== undefined && typeof text !== "string") {
    return { ok: false, message: '"text" must be a string.' };
  }
  if (edits !== undefined) {
    if (!Array.isArray(edits)) {
      return { ok: false, message: '"edits" must be a list.' };
    }
    for (const [index, edit] of edits.entries()) {
      const { op, path: editPath } = (edit ?? {}) as Record<string, unknown>;
      if (
        typeof op !== "string" ||
        !EDIT_OPS.has(op) ||
        !Array.isArray(editPath) ||
        !editPath.every(
          (segment) =>
            typeof segment === "string" || typeof segment === "number",
        )
      ) {
        return {
          ok: false,
          message: `Edit ${index + 1} must have an "op" of set, remove or insert and a "path" of names and indexes.`,
        };
      }
    }
  }
  return {
    ok: true,
    request: {
      base,
      text,
      edits: edits as ConfigEdit[] | undefined,
    },
  };
}

/** The candidate text a request describes, or core's reason it cannot be built. */
export function candidateText(
  file: ConfigFile,
  request: ChangeRequest,
): { ok: true; text: string } | { ok: false; errors: string[] } {
  const text = request.text ?? file.text;
  // Text with no edits on top is taken as written, even when it does not parse: the reader is
  // typing, and core's own parse error, with its offset, is the useful answer.
  if (request.edits === undefined || request.edits.length === 0) {
    return { ok: true, text };
  }
  try {
    return { ok: true, text: editConfigText(text, request.edits) };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { ok: false, errors: messageLines(error) };
    }
    throw error;
  }
}

/** The candidate as core loads it, or core's diagnostics, one per line. */
export function validateCandidate(
  corpus: Corpus,
  file: ConfigFile,
  text: string,
): { ok: true; loaded: LoadedConfiguration } | { ok: false; errors: string[] } {
  try {
    return {
      ok: true,
      loaded: parseConfiguration({
        text,
        cwd: corpus.rootDir,
        configPath: file.absolutePath,
      }),
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { ok: false, errors: messageLines(error) };
    }
    throw error;
  }
}

function messageLines(error: ConfigError): string[] {
  return error.message.split("\n").filter((line) => line.trim() !== "");
}

/** The canonical id of each rule entry, `null` for a custom rule or a name the registry does not know. */
export function entryRuleIds(config: LintConfig): (string | null)[] {
  return (config.rules ?? []).map((entry) =>
    entry.rule !== "custom" && ruleRegistry.has(entry.rule)
      ? ruleRegistry.resolveId(entry.rule)
      : null,
  );
}

/**
 * What the candidate would report, compared with what the current config reports now.
 *
 * Findings are matched on file, rule, line, severity and message, as a multiset: one that changed
 * any of those — a budget message whose number moved, a warning made an error — is gone in its old
 * form and new in its new one, which is what the reader needs to see.
 */
export async function previewCandidate(params: {
  corpus: Corpus;
  current: readonly LintMessage[];
  candidate: LoadedConfiguration;
  text: string;
}): Promise<Preview> {
  const { result, documentCount } = await params.corpus.lintCandidate(
    params.candidate,
  );
  const before = countByKey(params.current);
  const after = countByKey(result.messages);
  const added = difference(result.messages, before);
  const removed = difference(params.current, after);

  const byRule = new Map<string, { before: number; after: number }>();
  for (const [messages, side] of [
    [params.current, "before"],
    [result.messages, "after"],
  ] as const) {
    for (const message of messages) {
      const entry = byRule.get(message.ruleId) ?? { before: 0, after: 0 };
      entry[side] += 1;
      byRule.set(message.ruleId, entry);
    }
  }

  return {
    status: "ok",
    text: params.text,
    hash: hashText(params.text),
    config: params.candidate.config,
    ruleIds: entryRuleIds(params.candidate.config),
    documents: {
      before: params.corpus.documents.size,
      after: documentCount,
    },
    findings: {
      before: severityCounts(params.current),
      after: severityCounts(result.messages),
    },
    byRule: [...byRule]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([ruleId, counts]) => ({ ruleId, ...counts })),
    added: added.slice(0, LISTED_FINDINGS),
    removed: removed.slice(0, LISTED_FINDINGS),
    addedCount: added.length,
    removedCount: removed.length,
  };
}

function findingKey(message: LintMessage): string {
  return [
    message.filePath,
    message.ruleId,
    message.line,
    message.severity,
    message.message,
  ].join("\u0000");
}

function countByKey(messages: readonly LintMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const key = findingKey(message);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// The messages in `messages` beyond as many of each as `other` holds, in a stable order.
function difference(
  messages: readonly LintMessage[],
  other: ReadonlyMap<string, number>,
): PreviewFinding[] {
  const remaining = new Map(other);
  const result: PreviewFinding[] = [];
  for (const message of messages) {
    const key = findingKey(message);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      continue;
    }
    result.push({
      filePath: message.filePath,
      line: message.line,
      ruleId: message.ruleId,
      severity: message.severity,
      message: message.message,
    });
  }
  return result.sort(
    (left, right) =>
      compareStrings(left.filePath, right.filePath) ||
      left.line - right.line ||
      compareStrings(left.ruleId, right.ruleId) ||
      compareStrings(left.message, right.message),
  );
}

function severityCounts(messages: readonly LintMessage[]): PreviewCounts {
  const errors = messages.filter(
    (message) => message.severity === "error",
  ).length;
  return { errors, warnings: messages.length - errors };
}

export type SaveOutcome =
  | { status: "saved"; hash: string }
  | { status: "failed"; message: string };

/**
 * Write a validated candidate over the config, atomically, then read it back.
 *
 * `writeFileAtomic` replaces the file in one rename, so a failed write leaves the old file whole. The
 * read-back catches what it cannot: another process writing the file in the same moment. If what is
 * on disk afterwards is not the text written, or no longer loads, the previous text is put back, so
 * the viewer never leaves the repository with a config its next run would refuse.
 */
export async function saveCandidate(params: {
  corpus: Corpus;
  file: ConfigFile;
  text: string;
}): Promise<SaveOutcome> {
  const { corpus, file, text } = params;
  try {
    await writeFileAtomic(file.absolutePath, text);
  } catch (error) {
    return {
      status: "failed",
      message: `The config could not be written (${(error as NodeJS.ErrnoException).code ?? "write error"}); the file on disk is unchanged.`,
    };
  }
  const written = await readFile(file.absolutePath, "utf8").catch(
    () => undefined,
  );
  if (written === text && validateCandidate(corpus, file, written).ok) {
    return { status: "saved", hash: hashText(text) };
  }
  try {
    await writeFileAtomic(file.absolutePath, file.text);
  } catch {
    return {
      status: "failed",
      message:
        "The config changed while it was being saved, and the previous version could not be put back. Check the file before the next run.",
    };
  }
  return {
    status: "failed",
    message:
      "The config changed while it was being saved, so the previous version was put back. Reload the page and make the change again.",
  };
}

export type ConfigApi = {
  // `null` when there is no config file; `reason` then says why there is nothing to edit.
  file: { path: string; text: string; hash: string } | null;
  // The file as core parsed it, or core's diagnostics when it does not load.
  config: LintConfig | null;
  ruleIds: (string | null)[];
  errors: string[];
  writeBlocked: string | null;
  schema: unknown;
  rules: {
    id: string;
    alias: string;
    category: string;
    description: string;
    defaultSeverity: string;
    fixable: boolean;
    docsUrl?: string;
  }[];
};

/** Everything the page's script needs to build the editor. */
export async function configApi(
  corpus: Corpus,
  allowWrites: boolean,
): Promise<ConfigApi> {
  const file = await readConfigFile(corpus);
  const validated =
    file === undefined ? undefined : validateCandidate(corpus, file, file.text);
  return {
    file:
      file === undefined
        ? null
        : { path: file.displayPath, text: file.text, hash: file.hash },
    config: validated?.ok === true ? validated.loaded.config : null,
    ruleIds:
      validated?.ok === true ? entryRuleIds(validated.loaded.config) : [],
    errors: validated?.ok === false ? validated.errors : [],
    writeBlocked: (await writeBlockedReason(corpus, allowWrites)) ?? null,
    schema: CONFIG_SCHEMA,
    rules: registryRules(),
  };
}

function registryRules(): ConfigApi["rules"] {
  return ruleRegistry
    .getAllMetadata()
    .map((rule) => ({
      id: rule.id,
      alias: rule.alias,
      category: rule.category,
      description: rule.description,
      defaultSeverity: rule.defaultSeverity,
      fixable: rule.fixable,
      docsUrl: rule.docsUrl,
    }))
    .sort((left, right) => compareStrings(left.id, right.id));
}

/**
 * The page without its script: the file as it is, highlighted, and the registry's rules with the
 * ones the config runs marked. Editing needs the script, which builds its form from the schema.
 */
export async function renderConfigArticle(
  corpus: Corpus,
  options: {
    allowWrites: boolean;
    // Whether the copy button may offer the file's absolute path (`exposesAbsolutePaths`).
    showAbsolutePath: boolean;
    // Whether the file may be shown in the file manager or opened in its default application, which
    // starts a program on the machine running the viewer.
    canOpen: boolean;
  },
): Promise<ElementContent[]> {
  const file = await readConfigFile(corpus);
  const blocked = await writeBlockedReason(corpus, options.allowWrites);
  const configured = new Map(
    corpus.configuration.rules.map(({ rule, severity }) => [
      rule.id,
      severity ?? rule.defaultSeverity,
    ]),
  );
  const nodes: (ElementContent | undefined)[] = [
    h("h1", "Linter config"),
    file === undefined
      ? h(
          "p",
          "This repository has no wastech-mdlint config, so the linter runs with no rules. Create one with wastech-mdlint init, then reload this page to edit it.",
        )
      : h("p.config-file", [
          "Config file: ",
          h("code", file.displayPath),
          " ",
          copyPathButton(
            file.displayPath,
            options.showAbsolutePath ? file.absolutePath : undefined,
          ),
        ]),
    // Hidden until the script that sends them has run. Left out entirely where opening is off, since
    // the server would refuse them.
    file === undefined || !options.canOpen
      ? undefined
      : h("p.config-open", { hidden: true }, [
          h(
            "button.config-open-button",
            { type: "button", dataOpen: "reveal" },
            "Show in folder",
          ),
          h(
            "button.config-open-button",
            { type: "button", dataOpen: "open" },
            "Open in default app",
          ),
          h("span.config-open-status", { role: "status" }),
        ]),
    file === undefined
      ? undefined
      : h(
          "p.config-save-state",
          blocked ?? "Saving is on: a saved change is written to this file.",
        ),
    file === undefined
      ? undefined
      : h("div.config-editor", { hidden: true }, [
          h("p", "The editor is drawn by the page's script."),
        ]),
    file === undefined
      ? undefined
      : h("section.config-current", { ariaLabel: "Current file" }, [
          h("h2", "Current file"),
          await highlight(file.text, "jsonc"),
        ]),
    h("section.config-registry", { ariaLabel: "Rules" }, [
      h("h2", "Rules"),
      h("div.dashboard-table-wrap", [
        h("table.config-rules", [
          h(
            "thead",
            h("tr", [
              h("th", { scope: "col" }, "Rule"),
              h("th", { scope: "col" }, "Description"),
              h("th", { scope: "col" }, "Default"),
              h("th", { scope: "col" }, "In this config"),
            ]),
          ),
          h(
            "tbody",
            registryRules().map((rule) =>
              h("tr", [
                h(
                  "td",
                  rule.docsUrl === undefined
                    ? h("code", rule.id)
                    : h(
                        "a",
                        {
                          href: rule.docsUrl,
                          rel: "noopener noreferrer",
                          target: "_blank",
                        },
                        h("code", rule.id),
                      ),
                ),
                h("td", rule.description),
                h("td", rule.defaultSeverity),
                h("td", configured.get(rule.id) ?? "—"),
              ]),
            ),
          ),
        ]),
      ]),
    ]),
  ];
  return nodes.filter((node): node is ElementContent => node !== undefined);
}
