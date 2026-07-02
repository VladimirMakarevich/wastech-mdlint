import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { checkStructureRules } from "../src/rules/structure.js";
import type { AuditConfig, DependencyGraph } from "../src/types.js";

function createConfig(overrides: Partial<AuditConfig["structure"]> = {}, entrypoints?: string[]): AuditConfig {
  return {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      entrypoints: entrypoints ?? DEFAULT_CONFIG.llm.entrypoints
    },
    structure: {
      ...DEFAULT_CONFIG.structure,
      ...overrides
    }
  };
}

function createGraph(paths: string[], edges: Array<{ from: string; to: string }>): DependencyGraph {
  return {
    nodes: paths
      .map((path) => ({
        path,
        bytes: 1
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    edges: edges
      .map((edge) => ({
        ...edge,
        kind: "markdown-link" as const
      }))
      .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
  };
}

describe("checkStructureRules", () => {
  it("reports a single orphan as an error by default", () => {
    const findings = checkStructureRules({
      graph: createGraph(["docs/orphan.md"], []),
      config: createConfig()
    });

    expect(findings).toEqual([
      {
        ruleId: "structure/orphan-docs",
        severity: "error",
        path: "docs/orphan.md",
        message:
          "docs/orphan.md has no incoming Markdown links. Link it from an index document, remove it, or keep it as standalone when future suppression support exists."
      }
    ]);
  });

  it("downgrades orphan findings to warnings when configured", () => {
    const findings = checkStructureRules({
      graph: createGraph(["docs/orphan.md"], []),
      config: createConfig({ orphanDocs: "warning" })
    });

    expect(findings[0]?.severity).toBe("warning");
  });

  it("disables orphan findings when configured off", () => {
    const findings = checkStructureRules({
      graph: createGraph(["docs/orphan.md"], []),
      config: createConfig({ orphanDocs: "off" })
    });

    expect(findings).toEqual([]);
  });

  it("exempts README and configured entrypoints from orphan detection", () => {
    const findings = checkStructureRules({
      graph: createGraph(["README.md", "docs/AGENTS.md", "docs/orphan.md"], []),
      config: createConfig({}, ["docs/AGENTS.md"])
    });

    expect(findings).toEqual([
      {
        ruleId: "structure/orphan-docs",
        severity: "error",
        path: "docs/orphan.md",
        message:
          "docs/orphan.md has no incoming Markdown links. Link it from an index document, remove it, or keep it as standalone when future suppression support exists."
      }
    ]);
  });

  it("reports a simple two-file dependency cycle deterministically", () => {
    const findings = checkStructureRules({
      graph: createGraph(["docs/a.md", "docs/b.md"], [
        { from: "docs/a.md", to: "docs/b.md" },
        { from: "docs/b.md", to: "docs/a.md" }
      ]),
      config: createConfig()
    });

    expect(findings).toEqual([
      {
        ruleId: "graph/dependencies",
        severity: "warning",
        path: "docs/a.md",
        message: "Dependency cycle detected: docs/a.md -> docs/b.md -> docs/a.md."
      }
    ]);
  });

  it("reports a three-file dependency cycle deterministically", () => {
    const findings = checkStructureRules({
      graph: createGraph(["docs/a.md", "docs/b.md", "docs/c.md"], [
        { from: "docs/a.md", to: "docs/b.md" },
        { from: "docs/b.md", to: "docs/c.md" },
        { from: "docs/c.md", to: "docs/a.md" }
      ]),
      config: createConfig()
    });

    expect(findings).toEqual([
      {
        ruleId: "graph/dependencies",
        severity: "warning",
        path: "docs/a.md",
        message: "Dependency cycle detected: docs/a.md -> docs/b.md -> docs/c.md -> docs/a.md."
      }
    ]);
  });

  it("does not report cycles for acyclic graphs", () => {
    const findings = checkStructureRules({
      graph: createGraph(["README.md", "docs/guide.md"], [{ from: "README.md", to: "docs/guide.md" }]),
      config: createConfig()
    });

    expect(findings).toEqual([]);
  });
});
