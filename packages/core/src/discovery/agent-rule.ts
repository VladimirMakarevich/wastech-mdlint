import { ruleDocsUrl } from "../engine/rule-docs-url.js";
import type { DetectedPackageManager } from "./package-manager.js";

// The agent rule `init` can drop into a repository: a Markdown page that tells a coding agent how
// this repository's Markdown is linted, why a size budget is answered by splitting a document rather
// than by cutting it, and who decides on a split. Pure and fs-free, like the CI workflow template in
// config-writer.ts — core generates the bytes, the CLI host decides where and whether to write them.
//
// Only two facts are generated from the run: where the config lives and how the CLI is invoked.
// Everything else the config decides — which files are linted, which rules are on, every budget — is
// deliberately NOT copied into the page. The page is written once and never regenerated over a
// user's edits, so any copy of the config here would silently go stale the first time the config
// changed, and an agent would then follow the copy instead of the file it was copied from.

export type AgentRuleParams = {
  // Repository-root-relative POSIX path of the config the page describes. The page lives at the
  // repository root, so this is the path a reader of the page can actually follow.
  configPath: string;
  // Whether a local install of `@wastech-mdlint/cli` was found. Without one, the package-manager
  // forms below resolve no binary at all — and a bare `npx wastech-mdlint` would ask the registry for
  // an unrelated unscoped package — so the page falls back to fetching the pinned release instead.
  cliInstalled: boolean;
  packageManager: DetectedPackageManager;
  // The CLI release writing the page. It pins both the on-demand runner and the companion skill, for
  // the reason the skills pin themselves: one tag publishes the CLI and the skills together, and a
  // floating `latest` can reach a release whose surface has moved.
  cliVersion: string;
};

// The companion skill that walks an agent through a split. Named here rather than discovered: the
// page is written into a repository that has no copy of this one's `skills/` tree to look in.
const DOCS_SKILL_ID = "mdlint-docs";
const REPOSITORY_SLUG = "VladimirMakarevich/wastech-mdlint";

/**
 * A CommonMark inline code span for arbitrary text. The delimiter has to be one backtick longer than
 * the longest backtick run inside the text, or that run closes the span early; and a span whose
 * content starts or ends with a backtick — or both starts and ends with a space, which CommonMark
 * strips — needs one space of padding on each side to survive. A directory name is free to contain
 * any of these, and the page has to name it correctly anyway.
 */
function codeSpan(text: string): string {
  const longestRun = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const delimiter = "`".repeat(longestRun + 1);
  const needsPadding =
    text.startsWith("`") ||
    text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "");
  const padding = needsPadding ? " " : "";
  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}

// The same per-manager forms the shipped skills document, because those are the only forms that
// resolve an installed binary portably: there is no reliable bare `wastech-mdlint` on `PATH`. An
// undetected manager gets the npm form — npm ships with Node, so it is the one every machine has.
function installedRunner(packageManager: DetectedPackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm exec wastech-mdlint";
    case "yarn":
      return "yarn wastech-mdlint";
    case "bun":
      return "bunx wastech-mdlint";
    case "npm":
    case undefined:
      return "npx wastech-mdlint";
    default: {
      const exhaustiveCheck: never = packageManager;
      return exhaustiveCheck;
    }
  }
}

function cliRunner(params: AgentRuleParams): string {
  return params.cliInstalled
    ? installedRunner(params.packageManager)
    : `npx -y @wastech-mdlint/cli@${params.cliVersion}`;
}

/**
 * The Markdown text of the agent rule. Deterministic for a given input, LF-terminated, and free of
 * relative links: the page lands in a repository this tool knows nothing about, where the only
 * target guaranteed to exist is an absolute URL — a relative link would be a broken-link finding the
 * first time the page itself is linted.
 *
 * Throws on a config path containing a line terminator, which no inline code span can carry (a
 * newline inside one renders as a space, so the page would name a directory that does not exist).
 * The CLI declines the offer before reaching this, the same contract `buildCiWorkflowYaml` keeps.
 */
export function buildAgentRuleMarkdown(params: AgentRuleParams): string {
  if (/[\r\n]/.test(params.configPath)) {
    throw new TypeError(
      "buildAgentRuleMarkdown: configPath must not contain a line terminator.",
    );
  }

  const runner = cliRunner(params);
  const command = (args: string): string => codeSpan(`${runner} ${args}`);
  // `configPath` is already POSIX-normalized, so `/` is the only separator it can contain.
  const lastSeparator = params.configPath.lastIndexOf("/");
  const configDir =
    lastSeparator === -1
      ? undefined
      : params.configPath.slice(0, lastSeparator);
  // Every command below resolves the config by walking up from the directory it runs in, so naming
  // that directory is what makes the bare commands pick up the right config — a nested config is
  // invisible from the repository root.
  const whereToRun =
    configDir === undefined
      ? "from the repository root, where the config lives"
      : `from ${codeSpan(`${configDir}/`)}, the directory that holds the config`;

  const lines: string[] = [
    "# Markdown documents and wastech-mdlint",
    "",
    `These rules cover every Markdown file wastech-mdlint checks in this repository. Which files those are, which rules are on, and every size budget live in ${codeSpan(params.configPath)}: read the config rather than relying on a copy here, so this page cannot fall out of step with it. Paths on this page are relative to the repository root.`,
    "",
    "This page was written by `wastech-mdlint init`, which never overwrites it. Edit it to fit the repository — the table of who decides on a split above all.",
    "",
    "## Linting",
    "",
    `- Run the linter ${whereToRun}: ${command("lint")}. ${command("lint --fix")} applies the deterministic fixes, and ${command("lint --format json")} reports the findings as data, each with its \`ruleId\`, \`severity\` and \`filePath\`.`,
  ];

  if (!params.cliInstalled) {
    lines.push(
      `- These commands fetch the pinned \`@wastech-mdlint/cli\` release on demand, because none was installed when this page was written. Once the repository installs it as a dev dependency, run the installed copy through the package manager instead — for npm, ${codeSpan("npx wastech-mdlint lint")}.`,
    );
  }

  lines.push(
    "- **Changed a Markdown file — lint before you finish.** A run fails on `error` findings, not on warnings.",
    "- **An `error` gets fixed, not silenced.** Most often it is a broken link or anchor after a rename or a move: update every link to the file in the same change. Do not add an inline disable or switch the rule off to get a clean run.",
    `- **Before you move, rename or split a file, check its blast radius:** ${command("impact <file>")} lists every document that links to it, directly or through others, with \`<file>\` relative to the directory you run it from.`,
    "- When your host has the wastech-mdlint MCP server configured (`wastech-mdlint-mcp`, read-only), its `lint-files` and `impact-analysis` tools answer the same questions without a shell.",
    "",
    "## Size budgets: split, never cut",
    "",
    `[\`SIZE-001\`](${ruleDocsUrl("SIZE-001")}) budgets each file — bytes, lines and estimated tokens. [\`LLM-001\`](${ruleDocsUrl("LLM-001")}) budgets everything an entrypoint such as \`CLAUDE.md\` pulls in through eager \`@\` imports, summed. If the config enables neither yet, this section applies from the moment one is added.`,
    "",
    "- **A budget is never a reason to drop content.** The requested edit, detail, example or clarification goes in, in full. Refusing it, shortening it, squeezing the wording until it fits, or deleting other useful text to make room are all forbidden. The budget limits the file, not the knowledge: the answer to “it does not fit” is a finer-grained structure.",
    "- **Over budget — split the document; do not raise the threshold.** A threshold moves only when a whole class of files grows, and only with the user's agreement.",
    "- **A warning** means the file is close to its budget: say so in your report and propose a split (the table below decides who carries it out); the change itself is not blocked. **An error** means the document is split before the change is finished.",
    "",
    "### Who decides on a split",
    "",
    "| What is over budget | How it is split |",
    "| --- | --- |",
    "| Documentation under `docs/` | You split it on your own and list the new files in your report |",
    "| Skills, agents and commands (`.claude/`, `.agents/skills/`, `skills/`) | Only after the user confirms your split plan |",
    "| Agent rules and entrypoints (`.agents/rules/`, `AGENTS.md`, `CLAUDE.md`) | Only after a discussion with the user: the structure of the rules is the user's decision, and your plan is a starting point, not a request for approval |",
    "| Anything not listed above | Ask the user first |",
    "",
    "While a split waits for the user, the requested edit is still made in full. The file stays over budget and your report says so honestly — the lint result, why, and the proposed plan. A pending decision never holds the content back.",
    "",
    "### The split plan to put to the user",
    "",
    "- What triggered it: the file, the rule (`SIZE-001` or `LLM-001`), and the current size against the budget.",
    "- The new files: paths, names, and the one topic each of them covers.",
    "- What stays in the original file, and how it routes the reader to the parts.",
    "- Which inbound links change (from `impact`) and which indexes are updated.",
    "",
    "## How to split a document",
    "",
    "1. **Split by meaning, not by line count.** Each part is one coherent topic that reads without the others — never a “part 1 / part 2” cut in the middle of a thought.",
    "2. **The original path stays the entry point.** It keeps the essentials and becomes a router: what lives where and when to read it, with a link to each part. Links into it keep working; links to anchors that moved are updated in the same change.",
    "3. **Each part goes next to what it came from.** A skill keeps its trigger `description`, its workflow and its hard constraints in `SKILL.md` and moves the details to supporting files beside it (for example `references/<topic>.md`), each linked with a line on when to read it; an agent or a command does the same. A rule becomes sibling files in its rules directory, registered wherever the rules are listed. `AGENTS.md` and `CLAUDE.md` move details to a file reached by an ordinary link, never by an `@` import, because `LLM-001` counts only what is imported eagerly. A document under `docs/` becomes sibling files, or a folder with an index page.",
    "4. **Nothing is lost or duplicated.** Every statement of the original ends up in exactly one part — moved, not paraphrased away, and not copied into several parts.",
    "5. **Each part lands well under its warning threshold**, so the next edit does not trigger the same split again.",
    `6. **Verify:** ${command("lint")} is clean. Where the config enables them, \`REF-001\` and \`REF-002\` catch a broken link or anchor and \`GRP-001\` catches a new reference cycle.`,
    "",
    `The \`${DOCS_SKILL_ID}\` agent skill walks through a split step by step. Install it with ${codeSpan(`gh skill install ${REPOSITORY_SLUG} ${DOCS_SKILL_ID} --pin v${params.cliVersion}`)}.`,
  );

  return `${lines.join("\n")}\n`;
}
