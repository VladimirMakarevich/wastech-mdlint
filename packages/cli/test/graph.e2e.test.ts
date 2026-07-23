import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compareStrings } from "@wastech-mdlint/core";

import { EXIT_CODE_SUCCESS } from "../src/commands.js";
import { runCli } from "../src/program.js";

// P4.08: e2e coverage for `graph`/`slice`/`impact`/`lint` driven off a single committed, multi-doc
// fixture (packages/cli/test/fixtures/graph-project). Unlike cli.test.ts's ad hoc temp-dir fixtures,
// these commands are read-only, so the checked-in directory is used directly as `cwd` rather than
// copied into a tempdir per test.
const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/graph-project");

function createMemoryWriter() {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += chunk;
        return true;
      }
    },
    read() {
      return text;
    }
  };
}

async function run(argv: string[], cwd: string) {
  const stdout = createMemoryWriter();
  const stderr = createMemoryWriter();
  const exitCode = await runCli(argv, { cwd, stdout: stdout.stream, stderr: stderr.stream });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

describe("graph command over the fixture corpus", () => {
  it("summarizes nodes/edges/components/readingOrder + coverage as JSON", async () => {
    const result = await run(["graph", FIXTURE_ROOT, "--format", "json"], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as {
      nodes: { path: string }[];
      edges: { from: string; to: string; type: string }[];
      components: string[][];
      readingOrder: string[];
      coverage: { nodeCount: number; edgeCount: number; filesOutsideCorpus: string[] };
    };

    expect(payload.nodes.map((node) => node.path)).toEqual([
      "cycle-a.md",
      "cycle-b.md",
      "design.md",
      "glossary.md",
      "guide.md",
      "index.md",
      "orphan.md",
      "requirements.md"
    ]);

    expect(payload.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "index.md", to: "guide.md", type: "link" }),
        expect.objectContaining({ from: "index.md", to: "guide.md", type: "anchor" }),
        expect.objectContaining({ from: "index.md", to: "glossary.md", type: "import" }),
        expect.objectContaining({ from: "guide.md", to: "requirements.md", type: "link" }),
        expect.objectContaining({ from: "design.md", to: "requirements.md", type: "id-ref" })
      ])
    );

    expect(payload.components).toEqual([
      ["design.md", "glossary.md", "guide.md", "index.md", "requirements.md"],
      ["cycle-a.md", "cycle-b.md"],
      ["orphan.md"]
    ]);

    expect(payload.readingOrder).not.toContain("cycle-a.md");
    expect(payload.readingOrder).not.toContain("cycle-b.md");
    expect(payload.readingOrder).toHaveLength(payload.nodes.length - 2);

    // audit B: the G5 coverage signal now reaches JSON consumers, not just human output. appendix.md
    // is linked-to but outside `include`, exactly the "silently incomplete graph" case G5 exists for.
    expect(payload.coverage.filesOutsideCorpus).toEqual(["appendix.md"]);
    expect(payload.coverage.nodeCount).toBe(payload.nodes.length);
    expect(payload.coverage.edgeCount).toBe(payload.edges.length);
  });

  it("defaults to human format with hubs, clusters, reading order, and the coverage signal", async () => {
    const result = await run(["graph", FIXTURE_ROOT], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    expect(result.stdout).toContain("top hubs:");
    expect(result.stdout).toContain("clusters:");
    expect(result.stdout).toContain("excluded from reading order (2): cycle-a.md, cycle-b.md");
    expect(result.stdout).toContain("coverage:");
    expect(result.stdout).toContain("files outside corpus (1): appendix.md");
  });

  it("renders a Mermaid flowchart", async () => {
    const result = await run(["graph", FIXTURE_ROOT, "--format", "mermaid"], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("flowchart TD");
    expect(result.stdout).toContain('"requirements.md"');
  });

  it("renders a DOT digraph", async () => {
    const result = await run(["graph", FIXTURE_ROOT, "--format", "dot"], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("digraph ContextGraph {");
  });

  it("is deterministic: two runs produce byte-identical JSON with pre-sorted arrays", async () => {
    const first = await run(["graph", FIXTURE_ROOT, "--format", "json"], FIXTURE_ROOT);
    const second = await run(["graph", FIXTURE_ROOT, "--format", "json"], FIXTURE_ROOT);
    expect(second.stdout).toBe(first.stdout);

    const payload = JSON.parse(first.stdout) as {
      nodes: { path: string }[];
      edges: { from: string; to: string; type: string; line?: number }[];
    };
    expect(payload.nodes.map((node) => node.path)).toEqual(
      [...payload.nodes.map((node) => node.path)].sort(compareStrings)
    );
    const edgeSortKey = (edge: { from: string; to: string; type: string; line?: number }): string =>
      `${edge.from} ${edge.to} ${edge.type} ${edge.line ?? 0}`;
    expect(payload.edges.map(edgeSortKey)).toEqual(
      [...payload.edges.map(edgeSortKey)].sort(compareStrings)
    );
  });
});

describe("slice command over the fixture corpus", () => {
  it("resolves a path query within --depth hops", async () => {
    const result = await run(["slice", "guide.md", "--depth", "1", "--format", "json"], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as { matchKind: string; files: string[] };
    expect(payload.matchKind).toBe("path");
    expect(payload.files).toEqual(["guide.md", "requirements.md"]);
  });

  it("resolves an ID query through the configured settings.idRef", async () => {
    const result = await run(["slice", "REQ-1", "--format", "json"], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as { matchKind: string; starts: string[]; files: string[] };
    expect(payload.matchKind).toBe("id");
    expect(payload.starts).toEqual(["requirements.md"]);
    expect(payload.files).toEqual(["requirements.md"]);
  });
});

describe("impact command over the fixture corpus", () => {
  it("classifies the blast radius of requirements.md and scopes lint to the affected subgraph", async () => {
    const result = await run(["impact", "requirements.md", "--format", "json"], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as {
      changedFile: string;
      directlyAffected: { path: string; references: number }[];
      transitivelyAffected: { path: string; depth: number; via: string }[];
      lint: { files: string[]; messages: { filePath: string; ruleId: string }[] };
    };

    expect(payload.changedFile).toBe("requirements.md");
    expect(payload.directlyAffected).toEqual([
      { path: "design.md", references: 1 },
      { path: "guide.md", references: 1 }
    ]);
    expect(payload.transitivelyAffected).toEqual([{ path: "index.md", depth: 2, via: "guide.md" }]);

    // The affected subgraph is {requirements.md, design.md, guide.md, index.md} — cycle-a.md and
    // orphan.md sit outside it, so their GRP-001/GRP-002 findings must not leak into the scoped report.
    expect(payload.lint.files).toEqual(["design.md", "guide.md", "index.md", "requirements.md"]);
    expect(payload.lint.messages.some((message) => message.filePath === "cycle-a.md")).toBe(false);
    expect(payload.lint.messages.some((message) => message.filePath === "orphan.md")).toBe(false);
  });

  it("includes cycle-excluded nodes in the JSON payload for parity with human output (audit C)", async () => {
    // cycle-b.md's affected subgraph is exactly the cycle-a.md ↔ cycle-b.md 2-cycle, so topo-sort
    // emits nothing and both nodes land in `excluded` — the field a JSON consumer needs to explain
    // why readingOrder is empty despite affected files existing.
    const result = await run(["impact", "cycle-b.md", "--format", "json"], FIXTURE_ROOT);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as { readingOrder: string[]; excluded: string[] };
    expect(payload.readingOrder).toEqual([]);
    expect(payload.excluded).toEqual(["cycle-a.md", "cycle-b.md"]);
  });
});

describe("GRP-001/GRP-002 against the fixture corpus (P4.06 refactor confirmation)", () => {
  it("still flags the cycle-a.md/cycle-b.md cycle and the orphan.md orphan", async () => {
    const result = await run(
      ["lint", FIXTURE_ROOT, "--format", "json", "--fail-on", "off"],
      FIXTURE_ROOT
    );
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as {
      messages: { filePath: string; ruleId: string; data?: { cycle?: string[] } }[];
    };

    const cycleMessage = payload.messages.find((message) => message.ruleId === "GRP-001");
    expect(cycleMessage?.filePath).toBe("cycle-a.md");
    expect(cycleMessage?.data?.cycle).toEqual(expect.arrayContaining(["cycle-a.md", "cycle-b.md"]));

    expect(
      payload.messages.some((message) => message.ruleId === "GRP-002" && message.filePath === "orphan.md")
    ).toBe(true);
  });
});
