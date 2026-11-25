import {
  compareStrings,
  CONFIG_FILE_NAME,
  type GeneratedInitConfig,
  type InitConfigAction,
  type ProjectSchemaReason,
} from "@wastech-mdlint/core";

import {
  COMMENT_LOSS_NOTE,
  describeProjectSchemaReason,
} from "./init-draft.js";
import type { AgentRuleOutcome, CiWorkflowOutcome } from "./init-opt-in.js";
import type { SchemaWriteOutcome } from "./init-schema-write.js";

// The summaries `init` prints once the draft is settled: after a write, a skip, a failed write, or
// a merge that refused to write. Pure, so each wording is asserted directly.

// What to do about an existing `schema.json` init refused to replace. The advice cannot be one
// sentence for both reasons, because the two describe different files. Under `custom-rules` the file
// init would generate is the one this config needs, so the fix is to get out of its way. Under
// `no-installed-package` init only wanted the *name*: the file already there is almost certainly an
// unrelated schema, and the config's `$schema` is now pointed at it - which is the honest thing to
// say, rather than inviting a regeneration over a document init has no claim on.
function describeKeptSchemaAdvice(reason: ProjectSchemaReason): string {
  return reason === "custom-rules"
    ? "The config's $schema still points at it, so it may not validate the current rules until " +
        "they match. Remove or rename it and re-run init with --on-existing merge to regenerate it."
    : "The config's $schema points at it even though init did not generate it, so this config is " +
        "validated against whatever that file describes. Repoint $schema by hand, or move that " +
        "file aside and re-run init to generate one.";
}

function formatSchemaWriteLine(schema: SchemaWriteOutcome): string {
  const why = describeProjectSchemaReason(schema.reason);

  switch (schema.kind) {
    case "written":
      return `Wrote project-local schema ${schema.path} (${why}).`;
    case "unchanged":
      return `Project-local schema ${schema.path} is already up to date (${why}).`;
    case "kept":
      return (
        `Kept existing schema.json at ${schema.path} (${why}) - its contents ` +
        `differ from what init would generate, so it was left in place. ${describeKeptSchemaAdvice(
          schema.reason,
        )}`
      );
    case "overwritten":
      return `Overwrote schema.json at ${schema.path} (${why}), per --on-existing overwrite.`;
    case "unreadable":
      return (
        `Kept existing schema.json at ${schema.path} (${why}) - it exists but could ` +
        `not be read, so init cannot tell whether it matches and will not replace a file it is ` +
        `unable to inspect (check its permissions). ${describeKeptSchemaAdvice(
          schema.reason,
        )}`
      );
    default: {
      const exhaustiveCheck: never = schema.kind;
      return exhaustiveCheck;
    }
  }
}

/**
 * What this run did to the config before the opt-in files were offered. The opt-in lines tell the
 * user what state the config is in alongside the file that did or did not land, and after a `skip`
 * the write-path wording ("the config above was still written") would be false. A parameter rather
 * than a second pair of formatters, so the two wordings stay side by side and the write-path bytes
 * the e2e suite pins cannot drift while the skip wording is edited.
 */
type OptInConfigState = "written" | "untouched";

function formatCiWorkflowLine(
  ciWorkflow: CiWorkflowOutcome,
  configState: OptInConfigState,
): string {
  switch (ciWorkflow.kind) {
    case "written":
      return `Wrote CI workflow ${ciWorkflow.path}.`;
    case "failed": {
      const reason =
        ciWorkflow.code === undefined ? "" : ` (${ciWorkflow.code})`;
      const configNote =
        configState === "written"
          ? "the config above was still written"
          : "the existing config was left untouched";
      return (
        `Could not write the CI workflow ${ciWorkflow.path}${reason} - ${configNote}, and no ` +
        "partial workflow file was left behind. Re-run init to retry it, or add the workflow by " +
        "hand."
      );
    }
    case "kept":
      return `Kept the existing CI workflow ${ciWorkflow.path} - init never overwrites it. Check that ${
        configState === "written"
          ? "it still points at the config written above."
          : "it still points at the existing config."
      }`;
    case "unsafe-config-path":
      return (
        `Skipped the CI workflow ${ciWorkflow.path} - the config path contains a line terminator, ` +
        `which cannot be embedded safely in the workflow's shell command. ${
          configState === "written"
            ? "The config above was still written"
            : "The existing config was left untouched"
        }; add the workflow by hand, or rename the directory.`
      );
    default: {
      const exhaustiveCheck: never = ciWorkflow;
      return exhaustiveCheck;
    }
  }
}

// Each line says what the file is, where it went and why - the page is written into the user's
// repository on their behalf, and the one thing nobody can infer from its path alone is that nothing
// reads it yet. `init` deliberately does not edit `AGENTS.md` or `CLAUDE.md` to wire it in: those are
// the user's own files, and whether the page is loaded every session or read on demand is a budget
// decision only they can make.
function formatAgentRuleLine(
  agentRule: AgentRuleOutcome,
  configState: OptInConfigState,
): string {
  const configNote =
    configState === "written"
      ? "the config above was still written"
      : "the existing config was left untouched";
  switch (agentRule.kind) {
    case "written":
      return (
        `Wrote agent rule ${agentRule.path} - how coding agents should lint this repository's ` +
        "Markdown and answer a size budget: compress a document while no meaning is lost, then " +
        "split it, never cut its content. " +
        "Nothing loads it yet: reference it from AGENTS.md or CLAUDE.md - an @ import loads it " +
        "into every session and counts toward LLM-001, an ordinary link lets an agent read it " +
        "on demand."
      );
    case "failed": {
      const reason = agentRule.code === undefined ? "" : ` (${agentRule.code})`;
      return (
        `Could not write the agent rule ${agentRule.path}${reason} - ${configNote}, and no ` +
        "partial file was left behind. Re-run init to retry it."
      );
    }
    case "kept":
      return (
        `Kept the existing agent rule ${agentRule.path} - init never overwrites it, so edits made ` +
        "to it survive. Delete it and re-run init to regenerate it."
      );
    case "unsafe-config-path":
      return (
        `Skipped the agent rule ${agentRule.path} - the config path contains a line terminator, ` +
        `which the page cannot name. ${
          configState === "written"
            ? "The config above was still written"
            : "The existing config was left untouched"
        }; rename the directory and re-run init to add it.`
      );
    default: {
      const exhaustiveCheck: never = agentRule;
      return exhaustiveCheck;
    }
  }
}

/**
 * Deterministic write-outcome summary: how the config was written (fresh/merge), rule counts, which
 * `$schema` it points at, and where the config / project schema / CI workflow / agent rule landed. Every path is
 * a repository-relative POSIX path (so a subdirectory run reports `docs/wastech-mdlint.config.json`,
 * not a bare filename). Pure and exported so it can be asserted directly, mirroring `formatDraftSummary`.
 */
export function formatWriteSummary(params: {
  action: InitConfigAction;
  result: GeneratedInitConfig;
  configPath: string;
  // Whether the write just dropped JSONC comments the previous file carried. Required,
  // not optional, so a new call site cannot silently omit the one destructive part of a merge.
  commentsDropped: boolean;
  schema?: SchemaWriteOutcome;
  ciWorkflow?: CiWorkflowOutcome;
  agentRule?: AgentRuleOutcome;
}): string {
  const {
    action,
    result,
    configPath,
    commentsDropped,
    schema,
    ciWorkflow,
    agentRule,
  } = params;
  const lines: string[] = [];

  if (action === "merge") {
    lines.push(
      `Merged ${configPath}: ${result.addedRuleCount} new rule(s) appended (${result.totalRuleCount} total).`,
    );
  } else {
    lines.push(`Wrote ${configPath} with ${result.totalRuleCount} rule(s).`);
  }

  if (commentsDropped) {
    lines.push(`Note: ${COMMENT_LOSS_NOTE}`);
  }
  // A config that lints nothing is a legitimate outcome of deselecting every cluster, but a silent
  // one would look exactly like a broken install the first time `lint` reports zero files.
  if (result.wroteEmptyInclude) {
    lines.push(
      'Note: "include" was written as an empty list, because no doc cluster was selected - ' +
        "no files will be linted until you add a pattern to it.",
    );
  }

  lines.push(`Schema: ${result.schemaRef}`);
  if (schema !== undefined) {
    lines.push(formatSchemaWriteLine(schema));
  }
  if (ciWorkflow !== undefined) {
    lines.push(formatCiWorkflowLine(ciWorkflow, "written"));
  }
  if (agentRule !== undefined) {
    lines.push(formatAgentRuleLine(agentRule, "written"));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * The summary for a `skip` of an existing config: the skip line, then one line per opt-in file that
 * was written, kept, withheld or failed. With no opt-in outcome it is exactly the single skip line
 * a plain `--yes --on-existing skip` has always printed. That line is the whole of a plain skip's
 * output, so anything that recognises a skip by comparing against it - a CI script, an agent driving
 * `init` - would misread an unchanged run if the opt-in offers added a byte to it. Pure and exported so it can be asserted directly, mirroring `formatWriteSummary`.
 */
export function formatSkipSummary(params: {
  ciWorkflow?: CiWorkflowOutcome;
  agentRule?: AgentRuleOutcome;
}): string {
  const lines = ["skipped - existing config left untouched."];
  if (params.ciWorkflow !== undefined) {
    lines.push(formatCiWorkflowLine(params.ciWorkflow, "untouched"));
  }
  if (params.agentRule !== undefined) {
    lines.push(formatAgentRuleLine(params.agentRule, "untouched"));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The partial-write summary: a write that failed must still tell the user what
 * landed and what did not, on stdout, instead of leaving them to guess from a bare stderr errno.
 * `written`/`notWritten`/`failedPath` are repository-relative POSIX paths; the two lists are sorted
 * here (their order is incidental once the commit sequence has already happened) so the output is
 * deterministic.
 *
 * Only the errno `code` is rendered, never the raw fs message: Node's `rename` error embeds two
 * absolute, platform-native paths plus the random temp file name.
 */
export function formatWriteFailureSummary(params: {
  written: string[];
  notWritten: string[];
  failedPath: string;
  code?: string;
}): string {
  const reason = params.code === undefined ? "" : ` (${params.code})`;
  const lines: string[] = [
    `Write failed: could not replace ${params.failedPath}${reason}.`,
  ];

  const written = [...params.written].sort(compareStrings);
  lines.push(
    written.length === 0
      ? "Written: nothing."
      : `Written: ${written.join(", ")}.`,
  );

  // Always non-empty in practice (it holds at least the file that failed), but guarded so this pure
  // formatter never renders a dangling "Not written: ." line.
  const notWritten = [...params.notWritten].sort(compareStrings);
  if (notWritten.length > 0) {
    lines.push(
      `Not written: ${notWritten.join(", ")}. Every file listed as not written is ` +
        "byte-unchanged on disk: init stages each file next to its target and renames it into " +
        "place, so a failed write never truncates or partially replaces an existing file.",
    );
  }

  lines.push("Fix the cause and re-run init.");
  return `${lines.join("\n")}\n`;
}

/**
 * The "nothing written" outcome for the one abort case: a `merge` whose existing config could not be
 * read/parsed/validated. The deliverable requires never modifying or dropping an existing entry and
 * writing only a valid config - both unprovable when the existing config can't be parsed or would be
 * rejected by the loader - so the safe answer is to write nothing.
 * `configPath` is a normalized POSIX path, relative to the same directory the draft summary's
 * existing-config line already used (the original target directory, not necessarily the repo root).
 */
export function formatNotWrittenSummary(
  configPath: string | undefined,
): string {
  const location = configPath ?? CONFIG_FILE_NAME;
  return (
    `Not written: the existing config at ${location} could not be read, parsed, or validated, so a ` +
    "merge cannot guarantee a valid config with its existing entries preserved. Fix or remove it, " +
    "then re-run init.\n"
  );
}
