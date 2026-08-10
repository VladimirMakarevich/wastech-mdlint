import { describe, expect, it } from "vitest";

import type { DocumentProfile } from "../src/compile/doc-profile.js";
import type { ContextGraphEdge } from "../src/graph/context-graph-types.js";
import { synthesize, type SynthesizeInput } from "../src/compile/synthesize.js";

// What this file measures that no other compile test can: how the artifact's composition responds to
// the corpus *growing*. A share measured at one corpus size is the same number whether a section is
// capped or merely small there, which is how the bounding came to be inverted — the dependency block
// was capped and stated its caps while the inventory table and the reading order grew one entry per
// document with nothing said about it. At 151 documents those two were 97% of an artifact whose whole
// purpose is to be loaded into a context window whole, and roughly 20 000 tokens were projected at a
// thousand documents.
//
// So the property asserted here is not a share, it is a rule: every block either stays bounded as the
// corpus grows, or says in the artifact that it does not. A future section that starts scaling
// silently fails here even if it looks small in the fixture it was written against.
//
// `synthesize` is pure, so this runs on hand-built inputs — no temp directory, no parse pass, and the
// two corpus sizes cost microseconds rather than two 139-file materializations.

const SMALL_CORPUS = 50;
const LARGE_CORPUS = 200;

// A block that grows by more than this between the two sizes is treated as scaling with the corpus.
// Well clear of both outcomes: a capped block moves only by the width of the paths that replaced each
// other in its top-N selection (a few percent), while an uncapped one grows by roughly the 4x ratio
// between the corpus sizes.
const GROWTH_TOLERANCE = 1.5;

// The two sentences a growing block must carry. `Bounded summary:` marks a capped block and precedes
// its omission count; `Complete:` marks a block that is deliberately uncapped and therefore grows.
// A block carrying neither is one whose growth the artifact never mentions.
const DISCLOSURE_MARKERS = ["Bounded summary:", "Complete:"];

function edge(from: string, to: string): ContextGraphEdge {
  return { from, to, type: "link", line: 1 };
}

function documentPath(index: number): string {
  return `docs/area-${String(Math.floor(index / 10)).padStart(2, "0")}/topic-${String(index).padStart(3, "0")}.md`;
}

/**
 * A corpus of `count` documents that all reference one hub, in a single cycle-free chain.
 *
 * Only the document count varies between the two calls: the rule list, the budget block and the
 * command preset are identical, so a block that grows can only have grown with the corpus. Without
 * that discipline a rule-driven or entrypoint-driven section would look like a scaling one.
 */
function corpus(count: number): SynthesizeInput {
  const paths = Array.from({ length: count }, (_unused, index) =>
    documentPath(index),
  );
  const hub = paths[0]!;

  const profiles = new Map<string, DocumentProfile>(
    paths.map((path, index) => [
      path,
      {
        role: index === 0 ? "hub" : "entry",
        outline: [],
        tableSchemas: [],
        idPattern: undefined,
        referencesTo: index === 0 ? [] : [edge(path, hub)],
        referencedBy:
          index === 0 ? paths.slice(1).map((from) => edge(from, hub)) : [],
      },
    ]),
  );

  return {
    skill: { name: "growth-fixture", description: "Composition fixture." },
    sections: {
      architecture: true,
      rules: true,
      dependencies: true,
      workflow: true,
    },
    commandPreset: "generic",
    documentPaths: paths,
    profiles,
    analysis: {
      // The last two documents sit in a cycle, so the excluded list — the other uncapped block — is
      // non-empty at both sizes and grows with the corpus rather than being vacuously equal.
      readingOrder: paths.slice(0, -2),
      excludedFromReadingOrder: paths.slice(2).reverse(),
      components: [paths],
      classification: paths.map((path) => ({ path, role: "entry" as const })),
      cycles: [[paths.at(-2)!, paths.at(-1)!, paths.at(-2)!]],
    },
    ruleGroups: [
      {
        label: "References",
        category: "REF",
        rules: [
          { id: "REF-001", description: "Internal links resolve." },
          { id: "REF-002", description: "Anchors resolve." },
        ],
      },
    ],
    budget: {
      corpusTokenEstimate: 1000,
      llm001Enabled: false,
      entrypointsMatched: 0,
      entrypointsOverBudget: [],
    },
  };
}

/** Split an artifact into `## `/`### ` blocks, each running up to the next heading of either level. */
function blocksOf(content: string): Map<string, string> {
  const headings = [...content.matchAll(/^#{2,3} .+$/gm)];
  const blocks = new Map<string, string>();

  headings.forEach((heading, index) => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? content.length;
    blocks.set(heading[0], content.slice(start, end));
  });

  return blocks;
}

describe("SKILL.md composition as the corpus grows", () => {
  const small = synthesize(corpus(SMALL_CORPUS)).skillContent;
  const large = synthesize(corpus(LARGE_CORPUS)).skillContent;
  const smallBlocks = blocksOf(small);
  const largeBlocks = blocksOf(large);

  it("finds the same blocks at both corpus sizes", () => {
    // The comparison below is per-heading, so a heading present at only one size would silently drop
    // out of it rather than fail.
    expect([...largeBlocks.keys()]).toEqual([...smallBlocks.keys()]);
    expect(smallBlocks.size).toBeGreaterThan(5);
  });

  it("discloses every block that grows with the corpus", () => {
    const undisclosed: string[] = [];

    for (const [heading, largeBlock] of largeBlocks) {
      const smallBlock = smallBlocks.get(heading) ?? "";
      const grew = largeBlock.length > smallBlock.length * GROWTH_TOLERANCE;
      const discloses = DISCLOSURE_MARKERS.some((marker) =>
        largeBlock.includes(marker),
      );

      if (grew && !discloses) {
        undisclosed.push(heading);
      }
    }

    expect(undisclosed).toEqual([]);
  });

  it("keeps the two capped blocks bounded while the two complete ones grow", () => {
    const growth = (heading: string): number =>
      (largeBlocks.get(heading)?.length ?? 0) /
      (smallBlocks.get(heading)?.length ?? 1);

    // Non-vacuous in both directions: if nothing grew, the rule above would pass over an artifact
    // that had quietly capped the reading order, and if nothing stayed bounded the caps would not be
    // doing anything. Both halves have to be true for the disclosure rule to mean what it says.
    expect(growth("## Document Architecture")).toBeLessThan(GROWTH_TOLERANCE);
    expect(growth("### References")).toBeLessThan(GROWTH_TOLERANCE);
    expect(growth("### Reading Order")).toBeGreaterThan(3);
    expect(growth("### Cycles")).toBeGreaterThan(3);
  });

  it("accounts for essentially all of its own growth", () => {
    // The scale-free form of the claim. The artifact cannot promise a fixed orientation share at
    // every corpus size — the reading order and the excluded set are complete by design and grow
    // forever, so any such floor is eventually false. What it can promise is that the growth is
    // *declared*: nearly every byte the corpus adds lands in a block that says it grows. The
    // remainder is the handful of bytes a wider document count adds to counts and disclosures.
    const declaredGrowth = [...largeBlocks].reduce(
      (total, [heading, block]) => {
        if (!block.includes("Complete:")) {
          return total;
        }
        return total + block.length - (smallBlocks.get(heading)?.length ?? 0);
      },
      0,
    );

    expect(declaredGrowth / (large.length - small.length)).toBeGreaterThan(
      0.95,
    );
  });

  it("names the corpus size in the disclosures rather than only the bound", () => {
    // A bound alone does not tell a reader how much they are not seeing; the omission count does, and
    // it is the number that moves with the corpus.
    expect(small).toContain(
      `The 25 most-referenced of ${SMALL_CORPUS} documents are shown; the other ${SMALL_CORPUS - 25} are omitted`,
    );
    expect(large).toContain(
      `The 25 most-referenced of ${LARGE_CORPUS} documents are shown; the other ${LARGE_CORPUS - 25} are omitted`,
    );
    expect(large).toContain(
      `Complete: all ${LARGE_CORPUS - 2} document(s) in the order are listed, so this section grows with the corpus.`,
    );
  });
});
