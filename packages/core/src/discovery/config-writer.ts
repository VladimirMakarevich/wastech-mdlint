import path from "node:path";

import { createScanner, SyntaxKind } from "jsonc-parser";

import { DEFAULT_EXCLUDE_GLOBS } from "../config/corpus-scope.js";
import { compareStrings } from "../deterministic-sort.js";
import { canonicalizeRuleId } from "../rule-id.js";
import {
  generateConfigSchema,
  type CustomRuleDefinition,
} from "../engine/schema.js";
import { ruleRegistry } from "../engine/rules/index.js";
import { CUSTOM_ID_GRAMMAR } from "../engine/rules/custom.js";
import { normalizeRelativePath } from "./globs.js";
import type { InferredRule } from "./rule-inference.js";

// Config writer: the deterministic "config-text generation" half of `init`'s write step.
// Pure and fs-free (a sibling of repo-scan.ts/rule-inference.ts) — the CLI host does the actual
// `writeFile`, matching the same core-generates / host-writes split `compile`/`schema` already use.
// The hand-rolled JSONC serializer lives here because `JSON.stringify` cannot emit the per-rule
// rationale comments a written config is required to carry — one per proposed rule, explaining why
// `init` proposed it.

export type InitConfigAction = "fresh" | "merge";

// The already-parsed root object of an existing config, handed in by the CLI's read path. Only the
// raw JSONC object is carried — the merge is a parse-and-rebuild, not a byte-level text surgery, so
// the original file's own comments/formatting are intentionally not preserved (see the merge note).
export type ExistingConfigDocument = { raw: Record<string, unknown> };

export type GenerateInitConfigParams = {
  action: InitConfigAction;
  // Present only for "merge" — its every top-level key except `rules`/`$schema` is round-tripped
  // verbatim so nothing the user authored is silently dropped.
  existing?: ExistingConfigDocument;
  // From `buildConfigPreview`, and three-valued for "fresh". `undefined` omits the key
  // so the tool's own `**/*.md` default applies; a non-empty array is written as-is; `[]` is written
  // literally, which lints nothing. The empty array is reserved for the one case where that is a
  // real user choice — clusters were offered and the user deselected every one — because silently
  // omitting the key there inverts "lint none of these" into "lint the entire repository". Ignored
  // for "merge" (merge is additive and must never touch an existing `include`).
  include: string[] | undefined;
  // The full inferred set for "fresh"; the already-diffed new-only set for "merge" (the CLI does the
  // canonical-id diff before calling in). Each entry's rationale becomes its trailing `//` comment.
  newRules: InferredRule[];
  // The default `$schema` value: a local, relative path from the config being written to the
  // installed package schema. Computed by the CLI relative to the config's *own* directory — never a
  // fixed `./node_modules/...` literal — so a subdirectory config gets `../node_modules/...`.
  // `undefined` when the CLI found no installed package schema on disk (the ordinary `npx` case):
  // emitting a path to a file that does not exist would leave every editor reporting an unresolvable
  // `$schema`, so the project-local `./schema.json` is generated and pointed at instead.
  // Custom rules force that same project-local schema regardless.
  packageSchemaRef: string | undefined;
};

/**
 * Why a project-local `schema.json` had to be generated. Both reasons produce the same file, but
 * they mean different things to the user, so the host's write summary reports which it is: custom
 * rules make the local schema *necessary*, while the `npx` fallback makes it the
 * only resolvable target — an installed package schema would have been preferred.
 */
export type ProjectSchemaReason = "custom-rules" | "no-installed-package";

export type GeneratedInitConfig = {
  configText: string;
  schemaRef: string;
  // Present iff `schemaRef` points at the project-local schema. The caller must write this file,
  // otherwise `schemaRef` dangles — which is the whole defect the `no-installed-package` reason
  // exists to close.
  projectSchema?: {
    fileName: string;
    text: string;
    reason: ProjectSchemaReason;
  };
  addedRuleCount: number;
  totalRuleCount: number;
  // True when a literal `"include": []` was written — the "user deselected every cluster" outcome.
  // Required, not optional, so the caller has to decide whether to surface it: a config that lints
  // zero files is a legitimate but surprising result the write summary must state out loud.
  wroteEmptyInclude: boolean;
};

const PROJECT_SCHEMA_FILE_NAME = "schema.json";
const PROJECT_SCHEMA_REF = `./${PROJECT_SCHEMA_FILE_NAME}`;

// The CLI package (`@wastech-mdlint/cli`) ships `schema.json` at this path once installed. Exported
// so the CLI's (fs-bound) ancestor walk for the actual installed location checks the same segments
// this module's own (fs-free) relative-path math resolves `resolvePackageSchemaRef` against.
export const PACKAGE_SCHEMA_SEGMENTS = [
  "node_modules",
  "@wastech-mdlint",
  "cli",
  "schema.json",
] as const;

/**
 * The default `$schema` value: the relative POSIX path from the config's own directory to the
 * installed package schema. `schemaAnchorDir` is the directory holding
 * `node_modules/@wastech-mdlint/cli/schema.json` (resolved on disk by the CLI, or the project root
 * as a fallback — locating it requires fs, so that walk stays in the host), so a subdirectory config
 * gets `../node_modules/...` and a root config `./node_modules/...`. Pure path math — lives here
 * (not in the CLI host) so the config-text-generation logic this module owns stays in one place.
 */
export function resolvePackageSchemaRef(
  configDir: string,
  schemaAnchorDir: string,
): string {
  const relative = normalizeRelativePath(
    path.relative(
      configDir,
      path.join(schemaAnchorDir, ...PACKAGE_SCHEMA_SEGMENTS),
    ),
  );
  // A same-dir/descendant path needs an explicit `./` prefix; a `../` path already reads as relative.
  return relative.startsWith("../") ? relative : `./${relative}`;
}

// Canonical top-level key order, applied on every write rather than preserving an existing file's
// original order — simpler and fully deterministic, at only the cosmetic cost of reordering a merged
// file's keys. Any leftover unknown key is emitted after these, sorted, so it is never dropped.
const TOP_LEVEL_KEY_ORDER = [
  "$schema",
  "include",
  "exclude",
  "respectGitignore",
  "settings",
  "rules",
  "compile",
] as const;

// The `//` lines a fresh write puts above `exclude`. Without them the block reads
// as this config's own exclusions, and the natural edit — delete the line you disagree with — does
// nothing at all, because the same list is the lint-time default with or without a config. Stated
// as data rather than prose so the writer's tests can pin the wording that makes it actionable.
const EXCLUDE_KEY_COMMENT: readonly string[] = [
  "These are wastech-mdlint's own defaults, written out so they are visible rather than implicit.",
  "The same list applies with no config at all, and your entries EXTEND it rather than replace it —",
  'so deleting a line here changes nothing. To lint one of these trees, negate it: "!**/vendor/**".',
];

// Single-quote a value for POSIX sh so spaces or shell metacharacters (`#`, `&`, …) in an otherwise
// legal repo path can't split the argument or be reinterpreted. Embedded single quotes are closed,
// escaped, and reopened — the standard `'\''` idiom.
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * The opt-in workflow is self-contained: it installs the published CLI and runs `lint --fail-on
 * error` directly. It deliberately does NOT `uses:` a first-class composite Action — no such Action
 * is published, so a `uses:` reference would generate a workflow that cannot run. Swapping this
 * template to the `uses:` form is safe only once one exists.
 *
 * GitHub loads workflows only from the repo-root `.github/workflows`, so when the config being wired
 * lives in a subdirectory the caller passes its repo-root-relative POSIX path here. The lint step
 * then scopes to that config's *directory* (`lint <dir>`) AND passes `--config <file>`: `lintFiles`
 * resolves `include`/`exclude` relative to the command cwd, so without the directory arg the workflow
 * would lint the repo root against subdirectory-relative globs and match the wrong tree (or nothing).
 * It is a YAML literal block scalar (`run: |`) so the command is taken verbatim (no plain-scalar
 * `#`/split surprises) and each path is single-quoted for POSIX sh.
 *
 * The two arguments are anchored differently on purpose. `[path]` is repo-root-relative because the
 * workflow runs from the repo root; `--config` is relative to *that* directory, because the CLI
 * resolves a relative `--config` against `[path]`. Emitting the repo-root-relative config
 * path here — which is what this template did while the two bases disagreed — would now make every
 * generated workflow look for `<dir>/<dir>/wastech-mdlint.config.json` and exit `2` on its first run.
 *
 * A line terminator in the path cannot be represented in the block scalar and would silently mis-run,
 * so it is rejected (the CLI declines the opt-in workflow rather than reach this) — an explicit
 * contract guard, not a silent strip that would mis-target the config.
 *
 * Deliberately npm-universal: this never takes the repo's detected package
 * manager (`detectPackageManager` — bun/pnpm/yarn/npm), and `init-command.ts` does not thread it in
 * here. The install step only fetches the external `@wastech-mdlint/cli` tool into a scratch
 * `node_modules` — it never resolves or touches the target repo's own lockfile/workspace — and
 * `actions/setup-node` always provides npm, so every runner can execute this step with no extra
 * per-manager setup action. A bun/pnpm/yarn repo's own lockfile is simply irrelevant to what this
 * step installs, so the detection result is intentionally unused here, not silently dropped.
 */
export function buildCiWorkflowYaml(configPath?: string): string {
  if (configPath !== undefined && /[\r\n]/.test(configPath)) {
    throw new TypeError(
      "buildCiWorkflowYaml: configPath must not contain a line terminator.",
    );
  }

  let lintStep = "      - run: npx wastech-mdlint lint --fail-on error";
  if (configPath !== undefined) {
    // POSIX dirname/basename of the (already POSIX-normalized) config path; the caller only passes a
    // path for a subdirectory config, so a slash is expected, but default to "." defensively.
    const lastSlash = configPath.lastIndexOf("/");
    const configDir = lastSlash === -1 ? "." : configPath.slice(0, lastSlash);
    const configFile = configPath.slice(lastSlash + 1);
    const lintCommand = `npx wastech-mdlint lint ${shellSingleQuote(configDir)} --fail-on error --config ${shellSingleQuote(configFile)}`;
    lintStep = `      - run: |\n          ${lintCommand}`;
  }

  return `name: wastech-mdlint

on:
  push:
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install --no-save @wastech-mdlint/cli
${lintStep}
`;
}

// The repo-root default (no `config:` input): the shape `init` drops when bootstrapping the root.
export const CI_WORKFLOW_YAML = buildCiWorkflowYaml();

/**
 * True when `text` contains at least one JSONC comment. Used by the CLI to warn that a `merge` over
 * a comment-bearing config drops its comments: the merge is a parse-and-rebuild, so
 * every line and block comment the user wrote is lost, and the configuration guide advertises
 * comments as a feature — silence there is a data-loss surprise.
 *
 * Token-based (jsonc-parser's own scanner with trivia enabled) rather than a regex, so a `//` inside
 * a string value — a URL in `$schema`, a glob in `include` — is not a false positive.
 */
export function containsJsoncComments(text: string): boolean {
  const scanner = createScanner(text, false);

  for (;;) {
    const token = scanner.scan();
    if (token === SyntaxKind.EOF) {
      return false;
    }
    if (
      token === SyntaxKind.LineCommentTrivia ||
      token === SyntaxKind.BlockCommentTrivia
    ) {
      return true;
    }
  }
}

// One rule entry plus the rationale that becomes its trailing `// comment` (absent for a preserved
// existing entry — merge keeps those verbatim without inventing a comment).
type RuleItem = { entry: unknown; comment?: string };

function toRuleEntry(rule: InferredRule): Record<string, unknown> {
  return {
    rule: rule.rule,
    ...(rule.options === undefined ? {} : { options: rule.options }),
  };
}

// A written config always emits canonical ids. A merged existing entry keeps its
// severity/options verbatim but has its id canonicalized (built-in `rule` or `custom.id`) so an
// accepted noncanonical input like `ref001`/`req-owner` is not re-emitted noncanonically — and so a
// custom entry's id agrees with the `const` the generated project schema is built from. Spreading
// preserves the original key order (reassigning an existing key keeps its position).
function canonicalizeExistingEntry(entry: unknown): unknown {
  if (entry === null || typeof entry !== "object") {
    return entry;
  }
  const record = entry as Record<string, unknown>;
  if (record.rule === "custom") {
    return typeof record.id === "string"
      ? { ...record, id: canonicalizeRuleId(record.id) }
      : entry;
  }
  return typeof record.rule === "string"
    ? { ...record, rule: canonicalizeRuleId(record.rule) }
    : entry;
}

// Re-indents a `JSON.stringify(value, null, 2)` block so its continuation lines sit inside the
// top-level object's 2-space indent (the first line is already placed by the caller).
function indentValue(json: string): string {
  return json.replace(/\n/g, "\n  ");
}

// A rule rationale can embed a repo-derived path/glob (GRP-001's cycle path, SEC-001's include glob),
// and a stray line terminator in such a path — an unusual but valid filename edge — would end the
// `//` comment early and corrupt the JSONC. Collapse any run of line terminators (plus surrounding
// whitespace) to a single space so the comment always stays on one line.
function toCommentLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

// Renders the `rules[]` value by hand — one single-line entry per line, with
// each new entry's rationale appended as a trailing `//` comment. Built by hand because
// `JSON.stringify` cannot emit those comments.
function renderRulesValue(items: RuleItem[]): string {
  if (items.length === 0) {
    return "[]";
  }
  const lines = items.map((item, index) => {
    const comma = index === items.length - 1 ? "" : ",";
    const comment =
      item.comment === undefined ? "" : `  // ${toCommentLine(item.comment)}`;
    return `    ${JSON.stringify(item.entry)}${comma}${comment}`;
  });
  return `[\n${lines.join("\n")}\n  ]`;
}

// Mirrors resolveCustomRule's authoritative id checks (custom.ts): the namespaced grammar (imported
// from custom.ts, not re-declared, so the two can never silently drift) plus the reserved-prefix /
// built-in-collision guard. A preserved custom entry whose id fails these is rejected by
// loadConfiguration at runtime, so it must not seed a project schema that claims it is valid —
// feeding such an id to generateConfigSchema would make the written `$schema` disagree with the
// loader. The id is already canonicalized (matching resolveCustomRule's own normalization).
function isResolvableCustomId(canonicalId: string): boolean {
  if (!CUSTOM_ID_GRAMMAR.test(canonicalId)) {
    return false;
  }
  const prefix = canonicalId.split("-")[0] ?? "";
  return (
    !ruleRegistry.getReservedPrefixes().has(prefix) &&
    !ruleRegistry.has(canonicalId)
  );
}

// The merge identity of an existing `rules[]` entry. A built-in is keyed by its canonical `rule`; a
// custom rule is keyed by its canonical `id` (NOT the literal `"custom"`), so it can be diffed and
// schema-wired. `invalid` marks anything a safe additive merge cannot identify — a non-object, a
// non-string `rule`, or a `rule: "custom"` whose `id` is missing/non-string/not schemaable (fails
// resolveCustomRule's grammar + reserved-prefix guard). The caller routes `invalid` to the
// not-written abort rather than rewriting a config it can't reason about.
export type ExistingRuleIdentity =
  | { kind: "builtin"; canonicalId: string }
  | { kind: "custom"; rule: CustomRuleDefinition }
  | { kind: "invalid" };

/**
 * Classify one existing `rules[]` entry for merge (shared by the CLI's mergeability/diff check and
 * the project-schema builder below, so both agree on what a valid, identifiable entry is).
 */
export function identifyExistingRule(entry: unknown): ExistingRuleIdentity {
  if (entry === null || typeof entry !== "object") {
    return { kind: "invalid" };
  }
  const record = entry as {
    rule?: unknown;
    id?: unknown;
    description?: unknown;
  };
  if (typeof record.rule !== "string") {
    return { kind: "invalid" };
  }
  if (record.rule === "custom") {
    if (typeof record.id !== "string") {
      return { kind: "invalid" };
    }
    const id = canonicalizeRuleId(record.id);
    if (!isResolvableCustomId(id)) {
      return { kind: "invalid" };
    }
    return {
      kind: "custom",
      rule: {
        id,
        ...(typeof record.description === "string"
          ? { description: record.description }
          : {}),
      },
    };
  }
  return { kind: "builtin", canonicalId: canonicalizeRuleId(record.rule) };
}

// Deduped custom-rule descriptors from the final rule entries, for the project-local schema. Reuses
// `identifyExistingRule` so the schema's `const` ids match exactly what the merge check accepted (a
// `rule: "custom"` entry only ever arrives via a merged existing config — inference never proposes
// custom rules). By the time this runs on a real write, the CLI has already aborted any merge with an
// unidentifiable custom entry, so this is consistent with what was written.
function collectCustomRules(entries: unknown[]): CustomRuleDefinition[] {
  const byId = new Map<string, CustomRuleDefinition>();
  for (const entry of entries) {
    const identity = identifyExistingRule(entry);
    if (identity.kind === "custom" && !byId.has(identity.rule.id)) {
      byId.set(identity.rule.id, identity.rule);
    }
  }
  return [...byId.values()];
}

/**
 * Generates the final `wastech-mdlint.config.json` bytes and resolves its `$schema`. Deterministic:
 * identical params produce byte-identical output (no time/random).
 *
 * "fresh" writes `$schema`, an `include` (see the three-valued `include` param), an `exclude`, an
 * explicit `respectGitignore: true`, and the inferred `rules`. "merge" round-trips every existing
 * top-level key verbatim except `rules` (existing entries kept, new ones appended) and `$schema`
 * (always rewired — wiring it is this task's whole point). Because the merge round-trip goes through
 * `JSON.stringify`, the original file's comments do not survive it; the CLI warns about that using
 * {@link containsJsoncComments} rather than letting the loss pass unmentioned.
 */
export function generateInitConfig(
  params: GenerateInitConfigParams,
): GeneratedInitConfig {
  const { action, existing, include, newRules, packageSchemaRef } = params;

  const newItems: RuleItem[] = newRules.map((rule) => ({
    entry: toRuleEntry(rule),
    comment: rule.rationale,
  }));

  const existingRules =
    action === "merge" && Array.isArray(existing?.raw.rules)
      ? (existing.raw.rules as unknown[])
      : [];
  const existingItems: RuleItem[] = existingRules.map((entry) => ({
    entry: canonicalizeExistingEntry(entry),
  }));
  const ruleItems = [...existingItems, ...newItems];

  const finalEntries = ruleItems.map((item) => item.entry);
  const customRules = collectCustomRules(finalEntries);

  // Custom rules always live next to the config (`./schema.json`, written into the same dir), so the
  // project-schema ref is dir-independent. Falling back to it when `packageSchemaRef` is undefined
  // is what keeps the written `$schema` resolvable under `npx`, where nothing is installed locally
  // for a relative path to reach — a `$schema` that points at a nonexistent file is
  // worse than none, since every editor then silently drops config validation.
  const useProjectSchema =
    customRules.length > 0 || packageSchemaRef === undefined;
  const schemaRef = useProjectSchema ? PROJECT_SCHEMA_REF : packageSchemaRef;

  const values = new Map<string, string>();
  // `//` lines emitted immediately above a key, keyed the same way `values` is so the two stay in
  // step through the ordering pass below. Only `exclude` uses it today; a map rather than a special
  // case because the body build has to handle the general shape either way.
  const leadingComments = new Map<string, readonly string[]>();
  values.set("$schema", JSON.stringify(schemaRef));

  let wroteEmptyInclude = false;

  if (action === "merge" && existing !== undefined) {
    for (const [key, value] of Object.entries(existing.raw)) {
      if (key === "$schema" || key === "rules") {
        continue;
      }
      values.set(key, indentValue(JSON.stringify(value, null, 2)));
    }
  } else {
    // Fresh write. `include` is written whenever the caller supplied one — including a literal `[]`,
    // which lints zero files: `lintFiles` defaults `include` only when the key is *absent*, so
    // omitting it for a deliberate empty selection would invert "lint nothing" into "lint the whole
    // repo". `undefined` is the caller's way to ask for that default on purpose.
    if (include !== undefined) {
      values.set("include", indentValue(JSON.stringify(include, null, 2)));
      wroteEmptyInclude = include.length === 0;
    }
    // Both keys stay explicit in the written file so each remains a visible, editable decision.
    // `respectGitignore: true` is still the load-bearing one: it is pinned rather than left at the
    // resolver's `false` default, because the scan already skipped gitignored trees and a
    // config that lints them would contradict the draft the user approved.
    //
    // The written `exclude` is not the only thing in force — the same `DEFAULT_EXCLUDE_GLOBS`
    // applies on every run and a config's own `exclude` *extends* it (`config/corpus-scope.ts`), so
    // writing it here discloses the default rather than establishing it. The list is kept rather
    // than trimmed to what the default does not already cover: extend is
    // exactly what makes *deleting* one of these lines a no-op, and a bare list of a dozen globs
    // invites that dead edit. The key must also exist for a user to write a negation into. So the
    // duplication stays, and the comment below is what keeps it from being silent.
    values.set(
      "exclude",
      indentValue(JSON.stringify(DEFAULT_EXCLUDE_GLOBS, null, 2)),
    );
    leadingComments.set("exclude", EXCLUDE_KEY_COMMENT);
    values.set("respectGitignore", "true");
  }

  values.set("rules", renderRulesValue(ruleItems));

  // Canonical order first, then any leftover unknown key sorted, so nothing round-tripped from an
  // existing config is dropped and the output stays deterministic regardless of object key order.
  const orderedKeys = [
    ...TOP_LEVEL_KEY_ORDER.filter((key) => values.has(key)),
    ...[...values.keys()]
      .filter(
        (key) =>
          !TOP_LEVEL_KEY_ORDER.includes(
            key as (typeof TOP_LEVEL_KEY_ORDER)[number],
          ),
      )
      .sort(compareStrings),
  ];

  const body = orderedKeys
    .map((key) => {
      // The comma from the previous entry has already been emitted by the join, so a key's own
      // comment lines sit between that comma and the key — valid JSONC, and it reads as belonging
      // to the key below it rather than trailing the value above.
      const comment = (leadingComments.get(key) ?? [])
        .map((line) => `  // ${line}\n`)
        .join("");
      return `${comment}  ${JSON.stringify(key)}: ${values.get(key)!}`;
    })
    .join(",\n");
  const configText = `{\n${body}\n}\n`;

  return {
    configText,
    schemaRef,
    // Emitted whenever `schemaRef` names it, so the two can never disagree: with no custom rules the
    // generated schema is simply the built-in one, which is exactly what the `npx` fallback needs.
    // Custom rules win the reported reason when both hold — that is the one that constrains the
    // file's *contents*, not just its location.
    ...(useProjectSchema
      ? {
          projectSchema: {
            fileName: PROJECT_SCHEMA_FILE_NAME,
            text: generateConfigSchema(
              customRules.length > 0 ? { customRules } : undefined,
            ),
            reason:
              customRules.length > 0
                ? ("custom-rules" as const)
                : ("no-installed-package" as const),
          },
        }
      : {}),
    addedRuleCount: newItems.length,
    totalRuleCount: ruleItems.length,
    wroteEmptyInclude,
  };
}
