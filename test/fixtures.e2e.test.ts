import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODE_RUNTIME_ERROR, EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../src/cli.js";
import {
  normalizeFixtureOutput,
  runFixtureCli,
  runFixtureGraph,
  runFixtureScanJson
} from "./helpers/fixtures.js";

describe("fixture e2e", () => {
  it("renders a clean text report for the minimal fixture", async () => {
    const result = await runFixtureCli({
      fixtureName: "minimal",
      argv: ["scan", "<ROOT>", "--format", "text"]
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(normalizeFixtureOutput(result.stdout, result.rootPath)).toBe(`Markdown Context Audit
Root: <ROOT>
Files: 1
Findings: 0 error, 0 warning, 0 info
Graph: 1 nodes, 0 edges, 1 orphan docs (off), 0 cycles
Budgets: 0 entrypoints, 0 over limit
No findings.
`);
    expect(result.stderr).toBe("");
  });

  it("reports broken links and anchors in json output", async () => {
    const broken = await runFixtureScanJson("links-broken");
    const anchors = await runFixtureScanJson("anchors");

    expect((broken.payload as { findings: Array<{ ruleId: string; severity: string }> }).findings).toEqual([
      {
        ruleId: "links/broken-links",
        severity: "warning",
        path: "README.md",
        line: 1,
        column: 1,
        message: 'Broken local link "docs/missing.md": target file not found.'
      }
    ]);
    expect((anchors.payload as { findings: Array<{ message: string }> }).findings).toEqual([
      {
        ruleId: "links/broken-links",
        severity: "warning",
        path: "README.md",
        line: 1,
        column: 1,
        message: 'Broken local link "docs/guide.md#missing": anchor "missing" not found in docs/guide.md.'
      }
    ]);
  });

  it("reports size overruns and llm budget overruns", async () => {
    const size = await runFixtureScanJson("size-overrides");
    const llm = await runFixtureScanJson("llm-imports");

    expect((size.payload as { findings: Array<{ ruleId: string }> }).findings.map((finding) => finding.ruleId)).toEqual([
      "size/max-file-size"
    ]);
    expect((llm.payload as { findings: Array<{ ruleId: string }> }).findings.map((finding) => finding.ruleId)).toEqual([
      "llm/context-budget"
    ]);
  });

  it("reports orphan severities according to config", async () => {
    const orphanDefault = await runFixtureCli({
      fixtureName: "orphans",
      argv: ["scan", "<ROOT>", "--format", "json"]
    });
    const orphanWarning = await runFixtureCli({
      fixtureName: "orphans-warning",
      argv: ["scan", "<ROOT>", "--format", "json", "--fail-on", "warning"]
    });
    const orphanOff = await runFixtureCli({
      fixtureName: "orphans-off",
      argv: ["scan", "<ROOT>", "--format", "json"]
    });

    expect(orphanDefault.exitCode).toBe(EXIT_CODE_RUNTIME_ERROR);
    expect(
      (JSON.parse(orphanDefault.stdout) as { summary: { findings: { error: number } } }).summary.findings
    ).toEqual(
      expect.objectContaining({
        error: 1
      })
    );
    expect(orphanWarning.exitCode).toBe(EXIT_CODE_RUNTIME_ERROR);
    expect(
      (JSON.parse(orphanWarning.stdout) as { summary: { findings: { error: number; warning: number; info: number } } })
        .summary.findings
    ).toEqual({ error: 0, warning: 1, info: 0 });
    expect(orphanOff.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect((JSON.parse(orphanOff.stdout) as { findings: unknown[] }).findings).toEqual([]);
  });

  it("reports dependency cycles and writes deterministic graph output", async () => {
    const scan = await runFixtureScanJson("graph-cycles");
    const graph = await runFixtureGraph("graph-cycles");

    expect((scan.payload as { findings: Array<{ ruleId: string; message: string }> }).findings).toEqual([
      {
        ruleId: "graph/dependencies",
        severity: "warning",
        path: "docs/a.md",
        message: "Dependency cycle detected: docs/a.md -> docs/b.md -> docs/a.md."
      }
    ]);
    expect(normalizeFixtureOutput(graph.output, graph.rootPath)).toBe(`{
  "root": "<ROOT>",
  "configPath": "<ROOT>/wastech-mdlint.config.json",
  "graph": {
    "nodes": [
      {
        "path": "docs/a.md",
        "bytes": 10
      },
      {
        "path": "docs/b.md",
        "bytes": 10
      }
    ],
    "edges": [
      {
        "from": "docs/a.md",
        "to": "docs/b.md",
        "kind": "markdown-link"
      },
      {
        "from": "docs/b.md",
        "to": "docs/a.md",
        "kind": "markdown-link"
      }
    ]
  }
}
`);
  });

  it("accepts valid fixture config and rejects invalid fixture config", async () => {
    const valid = await runFixtureCli({
      fixtureName: "config",
      argv: ["scan", "<ROOT>", "--format", "json"]
    });
    const invalid = await runFixtureCli({
      fixtureName: "config",
      argv: [
        "scan",
        "<ROOT>",
        "--config",
        path.join("<ROOT>", "wastech-mdlint.invalid.json")
      ]
    });

    expect(valid.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(invalid.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("Invalid config:");
  });
});
