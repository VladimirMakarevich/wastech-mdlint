import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";

// A document naming a function, export or constant that no longer exists is the single most common
// shape of documentation drift this repository produces, and until now the only thing that found one
// was a person reading closely: an enforced architecture decision named three APIs absent from the
// tree, a host comment cited an expression that had moved packages, a module header counted three
// functions where there were four. Each was fixed one at a time, by a different round, months apart.
//
// The self-lint config catches a broken *link*, which is why seventeen dead links became a build
// failure. It cannot catch a code span naming a symbol, because nothing connects inline code to the
// source tree. This closes that half.
//
// **The corpus is deliberately small.** A guard that flags every inline code span flags CLI flags,
// config keys, shell fragments and table column names in rule examples — measured over `docs/guide`,
// most of what it would report is a Markdown table's `Owner` column — and a guard that reports noise
// is disabled within a week. So this starts where a wrong citation does the most damage: the
// documents contributors are told to obey.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * The checked corpus: precedence tiers 2 and 3 of `AGENTS.md` — the locked requirements and the
 * decision records. A wrong citation here does not merely misinform; it points a future change in
 * the wrong direction, which is what the tiers exist to prevent.
 *
 * **How this list grows**, mirroring the "a rule joins once it already reports zero" rule the
 * self-lint config states for itself: a document joins once a full run over it already reports zero,
 * so the gate is never red on the day it changes. Next candidate is the roadmap
 * (`docs/mdlint_v2/index.md`), which measures four spans today — `localeCompare` and `publishConfig`
 * among them, one a deliberately historical citation and one an npm manifest key. The glossary is
 * the candidate after that, and it needs the token source below widened to `test/support/` first,
 * because it documents shared test helpers (`assertBuilt`, the output-parity readers) by name.
 *
 * The phase task files are deliberately **not** candidates: they are a record of what a task did,
 * so a completed one naming an API that has since been renamed is history rather than drift.
 */
const CITED_DOCUMENT_DIRECTORIES = [
  "docs/mdlint_v2/decisions",
  "docs/mdlint_v2/requirements",
];

/**
 * Citations that deliberately name something absent from the source. Each needs a reason, and the
 * two assertions below keep the list from rotting in either direction: an entry whose citation is
 * gone is dead weight, and an entry whose name has since appeared in the source is an exemption that
 * is no longer needed — which for the first entry also means its document has become false.
 */
const DELIBERATE_CITATIONS: Record<string, string> = {
  globSync:
    '`core-hosts-the-pipeline.md` asserts this name\'s ABSENCE — "no `globSync` call exists in core" — ' +
    "as evidence that discovery reads through `node:fs/promises`. If it ever appears in the source, " +
    "that sentence is what has to change, and the second assertion below is what says so.",
  destructiveHint:
    "An MCP SDK annotation for the `fix` tool that M5 defers to a future version. The requirement " +
    "names it to state what such a tool would declare; nothing in the shipped six-tool surface uses it.",
  resolveConfig:
    "The planning name M3 gave the shared MCP config helper, quoted by its own amendment so a reader " +
    "who remembers the old name finds where it went. It shipped as `resolveToolConfiguration`. " +
    "This entry was added because the guard reported the amendment that fixed the citation — which is " +
    "the shape every superseded-name record has, and the reason the exemption takes a reason.",
};

// Every identifier token that appears anywhere in the three packages' source.
//
// Token presence, not the barrels' export list, and that is a deliberate weakening. The documents
// here legitimately cite internals the barrels do not carry (`displayConfigPath`, `resolveCorpusScope`
// — one of which was dropped from a barrel on purpose) and config keys declared as Zod object
// properties rather than as bindings (`respectGitignore`, `minCycleLength`), so an export-list check
// would report correct citations as defects and be switched off for it. The defect being caught is a
// name that is *gone from the tree*, which presence answers exactly.
//
// The bound that buys: a rename trips this only once the old name is gone from every source file, so
// a half-finished rename that leaves the old spelling in one comment still passes. That is the real
// shape of the failure anyway — a rename lands whole and the document is what gets forgotten.
function sourceTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const packageName of ["core", "cli", "mcp-server"]) {
    const sourceDir = path.join(repoRoot, "packages", packageName, "src");
    for (const file of typeScriptFilesUnder(sourceDir)) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /[A-Za-z_$][A-Za-z0-9_$]*/g,
      )) {
        tokens.add(match[0]);
      }
    }
  }
  return tokens;
}

function filesUnder(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(full, extension);
    }
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

function typeScriptFilesUnder(directory: string): string[] {
  return filesUnder(directory, ".ts");
}

/**
 * The name an inline code span cites, or `undefined` when the span is not a citation at all.
 *
 * Three shapes count, chosen because each is unambiguous in prose:
 * a call (`foo(...)`), a camelCase identifier, and a PascalCase one. What that leaves out is the
 * point — a lower-case word with no capital is as likely to be a config key or an English word as a
 * function, and anything carrying a space, slash, dot, dash or angle bracket is a flag, a path, a
 * shell fragment or a generic. A dotted member (`path.relative`) is out for v1 as well: its head is
 * usually a module or a namespace this check cannot resolve.
 */
function citedName(span: string): string | undefined {
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(span);
  if (call) {
    return call[1];
  }
  if (/^[a-z][A-Za-z0-9]*$/.test(span) && /[A-Z]/.test(span)) {
    return span;
  }
  if (/^[A-Z][A-Za-z0-9]*$/.test(span) && /[a-z]/.test(span.slice(1))) {
    return span;
  }
  return undefined;
}

interface Citation {
  /** Repository-relative POSIX path, so a failure message reads the same on every host. */
  readonly document: string;
  readonly name: string;
}

function citationsIn(relativePath: string): Citation[] {
  // Fenced blocks are examples, not claims: a `json` sample or a shell transcript names whatever it
  // needs to and is not asserting that this repository declares it.
  const prose = readFileSync(path.join(repoRoot, relativePath), "utf8").replace(
    /^```[\s\S]*?^```/gm,
    "",
  );
  return [...prose.matchAll(/`([^`\n]+)`/g)].flatMap((match) => {
    const name = citedName(match[1]!.trim());
    return name === undefined ? [] : [{ document: relativePath, name }];
  });
}

const documents = CITED_DOCUMENT_DIRECTORIES.flatMap((directory) =>
  filesUnder(path.join(repoRoot, directory), ".md").map((file) =>
    path.relative(repoRoot, file).split(path.sep).join("/"),
  ),
).sort(compareStrings);

const citations = documents.flatMap(citationsIn);
const tokens = sourceTokens();

describe("documented API citations", () => {
  it("reads a corpus big enough for the assertion below to mean anything", () => {
    // Without this, a renamed directory would empty the corpus and turn the guard into a green
    // assertion about nothing — the same "passed because it analyzed nothing" failure a narrowed
    // lint scope produces, and the one a guard can least afford.
    expect(documents.length).toBeGreaterThanOrEqual(10);
    expect(citations.length).toBeGreaterThanOrEqual(100);
    expect(tokens.size).toBeGreaterThanOrEqual(1000);
  });

  it("names only symbols that exist in the source tree", () => {
    const unresolved = [
      ...new Set(
        citations
          .filter(
            (citation) =>
              !tokens.has(citation.name) &&
              !(citation.name in DELIBERATE_CITATIONS),
          )
          .map((citation) => `${citation.document}: ${citation.name}`),
      ),
    ].sort(compareStrings);

    expect(
      unresolved,
      "These documents cite a name that appears nowhere in packages/*/src. Either the symbol was " +
        "renamed or removed and the document has to follow it, or the citation deliberately names " +
        "something absent — in which case add it to DELIBERATE_CITATIONS with the reason.",
    ).toEqual([]);
  });

  it("keeps every deliberate-citation entry live and still needed", () => {
    const cited = new Set(citations.map((citation) => citation.name));
    const stale = Object.keys(DELIBERATE_CITATIONS)
      .filter((name) => !cited.has(name) || tokens.has(name))
      .sort(compareStrings);

    expect(
      stale,
      "An exemption is stale when the citation it covers is gone from the corpus, or when the name " +
        "it exempts has appeared in the source — the second case also means a document asserting " +
        "that name's absence is now false. Delete the entry, and re-read the document first.",
    ).toEqual([]);
  });

  it("reads a code span as a citation only when it is shaped like one", () => {
    // The definition is the whole design: everything below was measured over `docs/guide`, where a
    // wider rule reports table column names and CLI flags by the dozen and gets itself turned off.
    expect({
      call: citedName("resolveCorpusScope(config)"),
      camelCase: citedName("respectGitignore"),
      pascalCase: citedName("ContextGraph"),
      flag: citedName("--fail-on"),
      configKey: citedName("include"),
      shell: citedName("npm run build"),
      documentPath: citedName("docs/guide/cli.md"),
      glob: citedName("**/*.md"),
      extension: citedName(".mdx"),
      generic: citedName("Map<string, Buffer>"),
      dottedMember: citedName("path.relative(cwd, configPath)"),
      snakeCasePath: citedName("node_modules"),
      screamingCase: citedName("TODO"),
    }).toEqual({
      call: "resolveCorpusScope",
      camelCase: "respectGitignore",
      pascalCase: "ContextGraph",
      flag: undefined,
      configKey: undefined,
      shell: undefined,
      documentPath: undefined,
      glob: undefined,
      extension: undefined,
      generic: undefined,
      dottedMember: undefined,
      snakeCasePath: undefined,
      screamingCase: undefined,
    });
  });
});
