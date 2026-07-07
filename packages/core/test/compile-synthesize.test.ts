import { describe, expect, it } from "vitest";

import type { RuleDescriptionGroup } from "../src/compile/describe-rules.js";
import type { DocumentProfile } from "../src/compile/doc-profile.js";
import type { GraphAnalysis } from "../src/compile/graph-analysis.js";
import { skillFrontmatterSchema } from "../src/compile/skill-frontmatter.js";
import {
  synthesize,
  type CompileBudget,
  type CompileCommandPreset,
  type CompileSections,
  type SynthesizeInput
} from "../src/compile/synthesize.js";

function profile(overrides: Partial<DocumentProfile> = {}): DocumentProfile {
  return {
    role: "isolated",
    outline: [],
    tableSchemas: [],
    idPattern: undefined,
    referencesTo: [],
    referencedBy: [],
    ...overrides
  };
}

function analysis(overrides: Partial<GraphAnalysis> = {}): GraphAnalysis {
  return {
    readingOrder: [],
    excludedFromReadingOrder: [],
    components: [],
    classification: [],
    cycles: [],
    ...overrides
  };
}

function budget(overrides: Partial<CompileBudget> = {}): CompileBudget {
  return { corpusTokenEstimate: 0, llm001Enabled: false, entrypointsMatched: 0, entrypointsOverBudget: [], ...overrides };
}

function input(overrides: Partial<SynthesizeInput> = {}): SynthesizeInput {
  return {
    skill: { name: "docs-skill", description: "A generated docs skill" },
    sections: { architecture: true, rules: true, dependencies: true, workflow: true },
    commandPreset: "generic",
    documentPaths: [],
    profiles: new Map(),
    analysis: analysis(),
    ruleGroups: [],
    budget: budget(),
    ...overrides
  };
}

const SECTION_HEADINGS: Record<keyof CompileSections, string> = {
  architecture: "## Document Architecture",
  rules: "## Document Rules",
  dependencies: "## Document Dependencies",
  workflow: "## Workflow"
};

function dependenciesSectionPrefix(content: string): string {
  const start = content.indexOf("## Document Dependencies");
  const commandIndex = content.indexOf("### Working with dependencies", start);
  return content.slice(start, commandIndex === -1 ? content.length : commandIndex);
}

describe("synthesize", () => {
  it("is deterministic across repeated calls", () => {
    const twoDocs = input({
      documentPaths: ["a.md", "b.md"],
      profiles: new Map([
        ["a.md", profile({ role: "entry", referencesTo: [{ from: "a.md", to: "b.md", type: "link", line: 1 }] })],
        ["b.md", profile({ role: "leaf", referencedBy: [{ from: "a.md", to: "b.md", type: "link", line: 1 }] })]
      ]),
      analysis: analysis({ readingOrder: ["a.md", "b.md"], components: [["a.md", "b.md"]] })
    });

    expect(synthesize(twoDocs)).toEqual(synthesize(twoDocs));
  });

  it("renders frontmatter that validates against the SKILL.md schema", () => {
    const result = synthesize(input({ skill: { name: "My Skill", description: "Does things" } }));

    expect(result.skillContent.startsWith('---\nname: "My Skill"\ndescription: "Does things"\n---')).toBe(true);
    expect(() => skillFrontmatterSchema.parse({ name: "My Skill", description: "Does things" })).not.toThrow();
  });

  it("throws when name or description is empty (S1 validation)", () => {
    expect(() => synthesize(input({ skill: { name: "", description: "x" } }))).toThrow();
    expect(() => synthesize(input({ skill: { name: "x", description: "" } }))).toThrow();
  });

  const commandBlocks: Record<Exclude<CompileCommandPreset, "none">, string> = {
    generic: [
      "### Working with dependencies",
      "",
      "- Trace what a change affects: run `wastech-mdlint impact <file>`, or call the",
      '  `impact-analysis` MCP tool with `{ "file": "<file>" }`.',
      "- Pull the context slice for a topic: run `wastech-mdlint slice <query>`, or call the",
      '  `context-slice` MCP tool with `{ "query": "<query>" }`.'
    ].join("\n"),
    claude: [
      "### Working with dependencies",
      "",
      "- Trace what a change affects:",
      "",
      "  !npx wastech-mdlint impact $ARGUMENTS",
      "",
      "- Pull the context slice for a topic:",
      "",
      "  !npx wastech-mdlint slice $ARGUMENTS"
    ].join("\n")
  };

  it.each(Object.entries(commandBlocks))("renders the locked %s command block verbatim", (preset, block) => {
    const result = synthesize(input({ commandPreset: preset as CompileCommandPreset }));
    expect(result.skillContent).toContain(block);
  });

  it("omits the command heading for the none preset but keeps reading order and references", () => {
    const result = synthesize(
      input({
        commandPreset: "none",
        documentPaths: ["a.md"],
        profiles: new Map([["a.md", profile()]]),
        analysis: analysis({ readingOrder: ["a.md"] })
      })
    );

    expect(result.skillContent).not.toContain("Working with dependencies");
    expect(result.skillContent).toContain("### Reading Order");
    expect(result.skillContent).toContain("### References");
  });

  it("keeps the non-command portion of Document Dependencies byte-identical across presets", () => {
    const documentPaths = ["a.md", "b.md"];
    const profiles = new Map([
      ["a.md", profile({ referencesTo: [{ from: "a.md", to: "b.md", type: "link", line: 1 }] })],
      ["b.md", profile({ referencedBy: [{ from: "a.md", to: "b.md", type: "link", line: 1 }] })]
    ]);
    const sharedAnalysis = analysis({ readingOrder: documentPaths });
    // Only Dependencies is enabled so the section's own trailing newline behavior is unambiguous.
    const sections: CompileSections = { architecture: false, rules: false, dependencies: true, workflow: false };

    const render = (commandPreset: CompileCommandPreset): string =>
      synthesize(input({ commandPreset, documentPaths, profiles, analysis: sharedAnalysis, sections })).skillContent;

    const genericSlice = dependenciesSectionPrefix(render("generic"));
    const claudeSlice = dependenciesSectionPrefix(render("claude"));
    const noneSlice = dependenciesSectionPrefix(render("none"));

    expect(genericSlice).toBe(claudeSlice);
    // "none" ends the section without a command block, so it's missing the blank-line separator
    // that would otherwise precede one.
    expect(noneSlice).toBe(genericSlice.slice(0, -1));
  });

  it.each(Object.keys(SECTION_HEADINGS) as (keyof CompileSections)[])(
    "omits exactly the %s section when gated off",
    (gatedOff) => {
      const sections: CompileSections = { architecture: true, rules: true, dependencies: true, workflow: true };
      sections[gatedOff] = false;
      const result = synthesize(input({ sections }));

      for (const [key, heading] of Object.entries(SECTION_HEADINGS)) {
        if (key === gatedOff) {
          expect(result.skillContent).not.toContain(heading);
        } else {
          expect(result.skillContent).toContain(heading);
        }
      }
    }
  );

  it("classifies each document type in the Document Architecture table", () => {
    // Finding: the reference/tabular/narrative type heuristic had no direct synthesize() coverage.
    const documentPaths = ["ref.md", "table.md", "prose.md"];
    const profiles = new Map([
      ["ref.md", profile({ role: "entry", idPattern: "REQ-NNN", tableSchemas: [{ headers: ["ID"], line: 1 }] })],
      ["table.md", profile({ role: "hub", tableSchemas: [{ headers: ["Name"], line: 1 }] })],
      ["prose.md", profile({ role: "leaf" })]
    ]);

    const result = synthesize(input({ documentPaths, profiles }));

    expect(result.skillContent).toContain("| Path | Role | Type |");
    expect(result.skillContent).toContain("| ref.md | entry | reference |");
    expect(result.skillContent).toContain("| table.md | hub | tabular |");
    expect(result.skillContent).toContain("| prose.md | leaf | narrative |");
  });

  it("renders '(no documents found)' in Document Architecture for an empty corpus", () => {
    const result = synthesize(input({ documentPaths: [], profiles: new Map() }));
    const architectureBlock = result.skillContent.slice(
      result.skillContent.indexOf("## Document Architecture"),
      result.skillContent.indexOf("## Document Rules")
    );

    expect(architectureBlock).toContain("(no documents found)");
    expect(architectureBlock).not.toContain("| Path | Role | Type |");
  });

  function workflowBlock(content: string): string {
    return content.slice(content.indexOf("## Workflow"));
  }

  it.each(["architecture", "rules", "dependencies"] as const)(
    "does not reference %s in Workflow when that section is gated off",
    (gatedOff) => {
      // Finding: Workflow always named all three gated sections, so disabling one made the
      // generated SKILL.md self-contradictory (pointing at a heading that isn't rendered).
      const sections: CompileSections = { architecture: true, rules: true, dependencies: true, workflow: true };
      sections[gatedOff] = false;
      const result = synthesize(input({ sections }));
      const block = workflowBlock(result.skillContent);

      expect(block).not.toContain(SECTION_HEADINGS[gatedOff].replace(/^##+\s*/, ""));
      // The Context Budget step is never gated, so it must always survive.
      expect(block).toContain("Context Budget");
    }
  );

  it("still renders a valid Workflow step (Context Budget) when architecture, rules, and dependencies are all off", () => {
    const sections: CompileSections = { architecture: false, rules: false, dependencies: false, workflow: true };
    const result = synthesize(input({ sections }));
    const block = workflowBlock(result.skillContent);

    expect(block).not.toContain("Document Architecture");
    expect(block).not.toContain("Document Rules");
    expect(block).not.toContain("Document Dependencies");
    expect(block).toContain("1. Mind the Context Budget");
  });

  it("renders cycles and excluded-from-reading-order explicitly (G6)", () => {
    const result = synthesize(
      input({
        documentPaths: ["a.md", "b.md", "c.md"],
        analysis: analysis({
          readingOrder: ["c.md"],
          excludedFromReadingOrder: ["a.md", "b.md"],
          cycles: [["a.md", "b.md", "a.md"]]
        })
      })
    );

    expect(result.skillContent).toContain("### Cycles");
    expect(result.skillContent).toContain("- `a.md -> b.md -> a.md`");
    expect(result.skillContent).toContain("Excluded from reading order: `a.md`, `b.md`");
  });

  it("does not claim an empty corpus when every document is cycle-excluded (G6)", () => {
    // Finding: an all-cyclic corpus has `readingOrder: []` but a non-empty corpus, so the Reading
    // Order block must not fall back to the same "(no documents found)" text an actually-empty
    // corpus gets — those are different facts.
    const result = synthesize(
      input({
        documentPaths: ["a.md", "b.md"],
        analysis: analysis({
          readingOrder: [],
          excludedFromReadingOrder: ["a.md", "b.md"],
          cycles: [["a.md", "b.md", "a.md"]]
        })
      })
    );

    const readingOrderBlock = result.skillContent.slice(
      result.skillContent.indexOf("### Reading Order"),
      result.skillContent.indexOf("### Cycles")
    );

    expect(readingOrderBlock).not.toContain("(no documents found)");
    expect(readingOrderBlock).toContain("excluded by cycles");
    expect(result.skillContent).toContain("### Cycles");
  });

  it("still reports an empty corpus honestly when there are truly no documents", () => {
    const result = synthesize(input({ documentPaths: [], analysis: analysis() }));
    const readingOrderBlock = result.skillContent.slice(
      result.skillContent.indexOf("### Reading Order"),
      result.skillContent.indexOf("### References")
    );

    expect(readingOrderBlock).toContain("(no documents found)");
  });

  it("renders over-budget entrypoints with their numbers", () => {
    const result = synthesize(
      input({
        budget: budget({
          corpusTokenEstimate: 500,
          llm001Enabled: true,
          entrypointsMatched: 1,
          entrypointsOverBudget: [{ path: "CLAUDE.md", totalTokens: 120, maxTokens: 100 }]
        })
      })
    );

    expect(result.skillContent).toContain("Corpus token estimate: 500 tokens.");
    expect(result.skillContent).toContain("`CLAUDE.md`: 120 estimated tokens exceeds 100 (20.0% over).");
  });

  it("renders 'within budget' when entrypoints are configured but none are over", () => {
    const result = synthesize(input({ budget: budget({ llm001Enabled: true, entrypointsMatched: 2 }) }));
    expect(result.skillContent).toContain("All configured entrypoints are within budget.");
  });

  it("renders 'not enabled' when no LLM-001 entrypoints are configured", () => {
    const result = synthesize(input({ budget: budget() }));
    expect(result.skillContent).toContain("No entrypoints configured (LLM-001 not enabled).");
  });

  it("renders a truthful zero-match state when LLM-001 is enabled but its glob matches no files", () => {
    // Distinct from "not enabled" (finding: an active LLM-001 rule whose `entrypoints` glob
    // matches zero corpus files must not be reported as if LLM-001 were off).
    const result = synthesize(input({ budget: budget({ llm001Enabled: true, entrypointsMatched: 0 }) }));

    expect(result.skillContent).toContain(
      "LLM-001 is enabled, but its configured entrypoints matched no files in this corpus."
    );
    expect(result.skillContent).not.toContain("No entrypoints configured (LLM-001 not enabled).");
  });

  it("always renders the Context Budget section even when every other section is gated off", () => {
    const sections: CompileSections = { architecture: false, rules: false, dependencies: false, workflow: false };
    const result = synthesize(input({ sections, budget: budget({ corpusTokenEstimate: 42 }) }));

    expect(result.skillContent).toContain("## Context Budget");
    expect(result.skillContent).toContain("Corpus token estimate: 42 tokens.");
  });

  it("computes metadata counts from input sizes", () => {
    const ruleGroups: RuleDescriptionGroup[] = [
      {
        category: "TBL",
        label: "Table Structure",
        rules: [
          { id: "TBL-001", description: "d1" },
          { id: "TBL-002", description: "d2" }
        ]
      },
      { category: "SEC", label: "Sections", rules: [{ id: "SEC-001", description: "d3" }] }
    ];

    const result = synthesize(
      input({
        documentPaths: ["a.md", "b.md", "c.md"],
        ruleGroups,
        analysis: analysis({ components: [["a.md"], ["b.md", "c.md"]] })
      })
    );

    expect(result.metadata.documentCount).toBe(3);
    expect(result.metadata.ruleCount).toBe(3);
    expect(result.metadata.componentCount).toBe(2);
    expect(result.metadata.contentHash).toMatch(/^[0-9a-f]{16}$/);
    // S4 exit criterion: the provenance line must actually be present in `skillContent`, and its
    // embedded hash must be the exact same value returned in `metadata.contentHash` — a regression
    // that drops or mismatches this line would otherwise pass unnoticed.
    expect(result.skillContent).toContain(
      `Generated from 3 docs, 3 rules · content hash sha256:${result.metadata.contentHash}`
    );
  });

  it("does not throw for empty documentPaths and ruleGroups", () => {
    expect(() => synthesize(input())).not.toThrow();
  });

  it("changes the content hash when ruleCount changes even though Document Rules is gated off", () => {
    // Finding: excluding the whole provenance line from the hash let two different `skillContent`
    // bodies (different `ruleCount`, hence different visible provenance text) share one
    // `contentHash`, because the gated-off Rules section never contributed `ruleGroups` to the hash
    // either.
    const sections: CompileSections = { architecture: true, rules: false, dependencies: true, workflow: true };
    const fewRules = synthesize(input({ sections, ruleGroups: [] }));
    const moreRules = synthesize(
      input({
        sections,
        ruleGroups: [{ category: "TBL", label: "Table Structure", rules: [{ id: "TBL-001", description: "d" }] }]
      })
    );

    expect(fewRules.metadata.ruleCount).toBe(0);
    expect(moreRules.metadata.ruleCount).toBe(1);
    expect(fewRules.metadata.contentHash).not.toBe(moreRules.metadata.contentHash);
  });

  it("changes the content hash when documentCount changes even though every section reading documentPaths is gated off", () => {
    const sections: CompileSections = { architecture: false, rules: true, dependencies: false, workflow: true };
    const noDocs = synthesize(input({ sections, documentPaths: [] }));
    const oneDoc = synthesize(
      input({ sections, documentPaths: ["a.md"], profiles: new Map([["a.md", profile()]]) })
    );

    expect(noDocs.metadata.documentCount).toBe(0);
    expect(oneDoc.metadata.documentCount).toBe(1);
    expect(noDocs.metadata.contentHash).not.toBe(oneDoc.metadata.contentHash);
  });

  it("collapses a multiline skill name to a single-line heading", () => {
    // Finding: a raw `# ${skill.name}` interpolation let an embedded newline end the heading line
    // early and inject the rest of the name as loose paragraph text.
    const result = synthesize(input({ skill: { name: "Line One\nLine Two", description: "d" } }));
    const lines = result.skillContent.split("\n");

    expect(lines).toContain("# Line One Line Two");
    expect(lines).not.toContain("# Line One");
    expect(lines).not.toContain("Line Two");
  });

  it("renders a document path containing a backtick as a valid code span", () => {
    // Finding: a raw `` `${documentPath}` `` interpolation broke if the path itself contained a
    // backtick. A single embedded backtick forces a fence one backtick longer than any run already
    // in the content, so the span can't be ambiguously closed by that backtick.
    const documentPath = "docs/weird`name.md";
    const result = synthesize(
      input({
        documentPaths: [documentPath],
        profiles: new Map([[documentPath, profile()]]),
        analysis: analysis({ readingOrder: [documentPath] })
      })
    );

    expect(result.skillContent).toContain("``docs/weird`name.md``");
  });

  it("escapes a document path containing a pipe in the Document Architecture table", () => {
    // Finding: a raw `| ${documentPath} | ... |` interpolation let a literal `|` in the path shift
    // the table's columns.
    const documentPath = "docs/a|b.md";
    const result = synthesize(
      input({ documentPaths: [documentPath], profiles: new Map([[documentPath, profile()]]) })
    );

    expect(result.skillContent).toContain("| docs/a\\|b.md | isolated | narrative |");
  });

  it("renders a CJK skill name and description intact in frontmatter and the heading", () => {
    // Finding: JSON.stringify does not escape non-ASCII BMP characters, so the hand-rolled YAML
    // frontmatter renderer passes CJK through byte-for-byte — this pins that (S1 has no ASCII
    // assumption), it doesn't change any rendering code.
    const result = synthesize(input({ skill: { name: "概要スキル", description: "日本語の説明文です" } }));

    expect(result.skillContent.startsWith('---\nname: "概要スキル"\ndescription: "日本語の説明文です"\n---')).toBe(
      true
    );
    expect(result.skillContent.split("\n")).toContain("# 概要スキル");
    expect(() =>
      skillFrontmatterSchema.parse({ name: "概要スキル", description: "日本語の説明文です" })
    ).not.toThrow();
  });
});
