import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// A generated 139-document corpus — the fixture P15.01 needs and this repository had no way to
// produce. Every defect W-26/W-27 describe only appears past a scale the existing 8-file fixtures
// cannot reach: the post-P9 audit's compile output was 1415 bytes, the field test's 110 789. The
// corpus is generated rather than checked in so its shape stays legible (each group below states
// what it exists to exercise) instead of having to be reverse-engineered from 139 files.
//
// This module deliberately imports **nothing from `../../src`**: packages/cli and
// packages/mcp-server import it across the workspace, and pulling core's source into their Vitest
// module graph would couple those suites to core's internal layout. The helpers that need a real
// `ContextGraph` live in the sibling `large-corpus-graph.ts` instead.
//
// It is also a plain module, not a `.test.ts` with exported constants (the P14.03 precedent):
// importing a test file re-registers its suites inside the importer.

// Group sizes. Chosen together so the corpus reproduces the *field* distribution rather than a
// shape tuned to make the assertions pass — W-28's honesty depends on that, since the register row
// it feeds quotes this fixture's measured role histogram.
const TOPIC_COUNT = 34;
const GUIDE_COUNT = 11;
const APPENDIX_COUNT = 4;
const STAGE_COUNT = 40;
const ISOLATED_COUNT = 46;
const AREA_SIZE = 5;
// Each topic and each stage links to its next three siblings, which is what gives interior
// documents an in-degree of 3 — exactly `DEFAULT_HUB_MIN_IN_DEGREE`, so they classify as `hub`.
const SIBLING_FANOUT = 3;

export const LARGE_CORPUS_DOCUMENT_COUNT = 139;

/** The one heavily-referenced document; its incoming edge list is what W-27's 17 530-char line was. */
export const LARGE_CORPUS_HUB_PATH = "reference/api-reference.md";

/**
 * Incoming edges on {@link LARGE_CORPUS_HUB_PATH}: three per topic (a link plus two anchors) and
 * two per guide. Well past the ~100 the plan asks for, and past any per-direction render cap.
 */
export const LARGE_CORPUS_HUB_IN_DEGREE = 124;

/** `inDegree === 0` nodes — the isolated documents plus the guides, which is how the summary counts them. */
export const LARGE_CORPUS_ENTRY_POINT_COUNT = ISOLATED_COUNT + GUIDE_COUNT;

/** The 3-node cycle plus the 40-document tail reachable only through it. */
export const LARGE_CORPUS_EXCLUDED_COUNT = 3 + STAGE_COUNT;

/** Everything except the isolated documents, which are singleton components. */
export const LARGE_CORPUS_LARGEST_CLUSTER_SIZE =
  LARGE_CORPUS_DOCUMENT_COUNT - ISOLATED_COUNT;

export const LARGE_CORPUS_COMPONENT_COUNT = 1 + ISOLATED_COUNT;

/**
 * The width every human-facing line must stay under at this corpus size. Not a product constant:
 * a single path is rendered whole on its own line, so no renderer can promise a character bound
 * independent of the corpus. What the renderers bound is the number of *items* per line; this is
 * the fixture-scoped consequence of that, and the number the exit criteria state.
 */
export const LARGE_CORPUS_LINE_WIDTH_BOUND = 200;

export const LARGE_CORPUS_CONFIG_FILENAME = "wastech-mdlint.config.json";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// Paths are 23–30 characters, in the range a real docs tree produces, so a line-width assertion is
// measuring the renderer's item count rather than artificially short names.
function topicPath(index: number): string {
  const area = pad2(Math.floor(index / AREA_SIZE) + 1);
  return `docs/area-${area}/topic-${pad2(index % AREA_SIZE)}.md`;
}

function guidePath(index: number): string {
  return `docs/guides/guide-${pad2(index)}.md`;
}

function appendixPath(index: number): string {
  return `docs/appendix/appendix-${index}.md`;
}

function stagePath(index: number): string {
  return `docs/lifecycle/stage-${pad2(index)}.md`;
}

function isolatedPath(index: number): string {
  return `docs/archive/legacy-note-${pad2(index)}.md`;
}

const LOOP_PATHS = [
  "docs/lifecycle/loop-a.md",
  "docs/lifecycle/loop-b.md",
  "docs/lifecycle/loop-c.md",
] as const;

// Markdown link with a source-relative target, so the corpus exercises the same
// `resolveRelativeToSource` path a real repository does rather than root-relative shorthand.
function link(from: string, to: string, text: string, anchor = ""): string {
  const target = path.posix.relative(path.posix.dirname(from), to);
  return `[${text}](${target}${anchor})`;
}

// Two headings so the `#requests` / `#responses` fragments resolve to real slugs — the graph
// builder drops an anchor edge whose fragment matches no heading, which would silently cost the
// hub two thirds of its in-degree.
function hubContent(): string {
  return [
    "# API reference",
    "",
    "The contract every area document links back to.",
    "",
    "## Requests",
    "",
    "Request shapes.",
    "",
    "## Responses",
    "",
    "Response shapes.",
    "",
  ].join("\n");
}

function topicContent(index: number): string {
  const self = topicPath(index);
  const siblings: string[] = [];
  for (let offset = 1; offset <= SIBLING_FANOUT; offset += 1) {
    const next = index + offset;
    if (next < TOPIC_COUNT) {
      siblings.push(link(self, topicPath(next), `topic ${pad2(next)}`));
    }
  }

  const lines = [
    `# Topic ${pad2(index)}`,
    "",
    `Start from the ${link(self, LARGE_CORPUS_HUB_PATH, "API reference")}: the ` +
      `${link(self, LARGE_CORPUS_HUB_PATH, "request contract", "#requests")} and the ` +
      `${link(self, LARGE_CORPUS_HUB_PATH, "response contract", "#responses")} are the parts ` +
      "this topic depends on.",
    "",
  ];

  if (siblings.length > 0) {
    lines.push(`Read next: ${siblings.join(", ")}.`, "");
  }

  // The single edge that joins the cyclic lifecycle chain to the main component, so the corpus has
  // one large cluster with a cycle inside it rather than two unrelated clusters.
  if (index === 0) {
    lines.push(
      `Release mechanics live in the ${link(self, LOOP_PATHS[0], "release loop")}.`,
      "",
    );
  }

  return lines.join("\n");
}

function guideContent(index: number): string {
  const self = guidePath(index);
  const entryTopics = [0, 1, 2].map((topic) =>
    link(self, topicPath(topic), `topic ${pad2(topic)}`),
  );

  const lines = [
    `# Guide ${pad2(index)}`,
    "",
    `Orientation. See the ${link(self, LARGE_CORPUS_HUB_PATH, "API reference")} and its ` +
      `${link(self, LARGE_CORPUS_HUB_PATH, "requests", "#requests")} section.`,
    "",
    `Entry topics: ${entryTopics.join(", ")}.`,
    "",
  ];

  // Only the first four guides cite an appendix, so each appendix keeps in-degree 1 and out-degree
  // 0 — the `leaf` role, which nothing else in the corpus produces.
  if (index < APPENDIX_COUNT) {
    lines.push(
      `Background: ${link(self, appendixPath(index), `appendix ${index}`)}.`,
      "",
    );
  }

  return lines.join("\n");
}

function appendixContent(index: number): string {
  return [
    `# Appendix ${index}`,
    "",
    "Terminal background material: nothing here links onward.",
    "",
  ].join("\n");
}

function loopContent(index: number): string {
  const self = LOOP_PATHS[index]!;
  const next = LOOP_PATHS[(index + 1) % LOOP_PATHS.length]!;
  const lines = [
    `# Release loop ${String.fromCharCode(97 + index)}`,
    "",
    `Continues in ${link(self, next, "the next step")}.`,
    "",
  ];

  // The last loop member is the only way into the stage chain, which is what makes all 40 stages
  // unreachable in topological order rather than merely the 3 cycle members.
  if (index === LOOP_PATHS.length - 1) {
    const heads = [0, 1, 2].map((stage) =>
      link(self, stagePath(stage), `stage ${pad2(stage)}`),
    );
    lines.push(`Stages: ${heads.join(", ")}.`, "");
  }

  return lines.join("\n");
}

function stageContent(index: number): string {
  const self = stagePath(index);
  const successors: string[] = [];
  for (let offset = 1; offset <= SIBLING_FANOUT; offset += 1) {
    const next = index + offset;
    if (next < STAGE_COUNT) {
      successors.push(link(self, stagePath(next), `stage ${pad2(next)}`));
    }
  }

  const lines = [`# Stage ${pad2(index)}`, ""];
  if (successors.length > 0) {
    lines.push(`Followed by: ${successors.join(", ")}.`, "");
  } else {
    lines.push("The chain ends here.", "");
  }

  return lines.join("\n");
}

function isolatedContent(index: number): string {
  return [
    `# Legacy note ${pad2(index)}`,
    "",
    "Archived prose with no incoming or outgoing references.",
    "",
  ].join("\n");
}

/**
 * The corpus as repo-relative POSIX path → Markdown. Pure and deterministic: no randomness, no
 * clock, no filesystem — the same object every call, which is what lets a determinism assertion
 * mean something.
 */
export function largeCorpusFiles(): Record<string, string> {
  const files: Record<string, string> = {
    [LARGE_CORPUS_HUB_PATH]: hubContent(),
  };

  for (let index = 0; index < TOPIC_COUNT; index += 1) {
    files[topicPath(index)] = topicContent(index);
  }
  for (let index = 0; index < GUIDE_COUNT; index += 1) {
    files[guidePath(index)] = guideContent(index);
  }
  for (let index = 0; index < APPENDIX_COUNT; index += 1) {
    files[appendixPath(index)] = appendixContent(index);
  }
  for (let index = 0; index < LOOP_PATHS.length; index += 1) {
    files[LOOP_PATHS[index]!] = loopContent(index);
  }
  for (let index = 0; index < STAGE_COUNT; index += 1) {
    files[stagePath(index)] = stageContent(index);
  }
  for (let index = 0; index < ISOLATED_COUNT; index += 1) {
    files[isolatedPath(index)] = isolatedContent(index);
  }

  return files;
}

/**
 * The config `compileContext` requires (it throws `CompileConfigMissingError` without a `compile`
 * section). The rule list is a realistic option-free selection across five families, so
 * `Document Rules` renders the grouped output W-27 asks the compiler to give budget back to —
 * an empty `rules` array would collapse that section to "(no rules configured)" and make the
 * section-share assertion vacuous.
 */
export function largeCorpusConfigJson(): string {
  return `${JSON.stringify(
    {
      include: ["**/*.md"],
      rules: [
        { rule: "REF-001" },
        { rule: "REF-002" },
        { rule: "REF-003" },
        { rule: "CTX-001" },
        { rule: "CTX-002" },
        { rule: "GRP-001" },
        { rule: "GRP-002" },
        { rule: "SIZE-001", options: { tokens: { warn: 4000 } } },
        {
          rule: "LLM-001",
          options: {
            entrypoints: ["docs/guides/*.md"],
            maxTokensPerEntrypoint: 8000,
          },
        },
      ],
      compile: {
        skill: {
          name: "large-corpus-context",
          description: "Generated context for the large-corpus fixture.",
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Materialize the corpus (plus its config) under `dir`. Used by the CLI and MCP suites, which need
 * the renderers exercised through a real process/tool boundary rather than in-process.
 */
export async function writeLargeCorpus(dir: string): Promise<void> {
  const files: Record<string, string> = {
    ...largeCorpusFiles(),
    [LARGE_CORPUS_CONFIG_FILENAME]: largeCorpusConfigJson(),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}
