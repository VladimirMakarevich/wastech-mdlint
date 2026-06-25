import { describe, expect, it } from "vitest";

import {
  createAuditResult,
  renderAuditResultJson,
  renderAuditResultText
} from "../src/reporting/render.js";
import type { EntrypointBudget, Finding, MarkdownFile } from "../src/types.js";

function createMarkdownFile(path: string, bytes: number): MarkdownFile {
  return {
    path,
    absolutePath: `/repo/${path}`,
    bytes,
    text: "x".repeat(bytes)
  };
}

function createBudget(entrypoint: string, overLimit = false): EntrypointBudget {
  return {
    entrypoint,
    ownBytes: 10,
    ownEstimatedTokens: 3,
    importedFiles: [],
    totalBytes: 10,
    totalEstimatedTokens: overLimit ? 9 : 3,
    maxTokens: 5,
    overLimit,
    cycles: [],
    missingImports: []
  };
}

describe("reporting", () => {
  it("renders a clean text report for empty findings", () => {
    const result = createAuditResult({
      rootPath: "/repo",
      files: [createMarkdownFile("README.md", 12)],
      findings: [],
      graph: {
        nodes: [{ path: "README.md", bytes: 12 }],
        edges: []
      },
      budgets: []
    });

    expect(renderAuditResultText(result, "error")).toBe(`Markdown Context Audit
Root: /repo
Files: 1
Findings: 0 error, 0 warning, 0 info
Graph: 1 nodes, 0 edges, 1 orphan docs (error), 0 cycles
Budgets: 0 entrypoints, 0 over limit
No findings.
`);
  });

  it("renders findings grouped by severity and rule id", () => {
    const findings: Finding[] = [
      {
        ruleId: "size/max-file-size",
        severity: "warning",
        path: "docs/guide.md",
        message: "Too large."
      },
      {
        ruleId: "links/broken-links",
        severity: "warning",
        path: "README.md",
        line: 3,
        column: 2,
        message: "Broken link."
      },
      {
        ruleId: "config/example",
        severity: "error",
        path: "AGENTS.md",
        message: "Invalid config."
      }
    ];
    const result = createAuditResult({
      rootPath: "/repo",
      files: [createMarkdownFile("README.md", 10)],
      findings,
      graph: {
        nodes: [{ path: "README.md", bytes: 10 }],
        edges: []
      },
      budgets: [createBudget("CLAUDE.md", true)]
    });

    expect(renderAuditResultText(result, "warning")).toBe(`Markdown Context Audit
Root: /repo
Files: 1
Findings: 1 error, 2 warning, 0 info
Graph: 1 nodes, 0 edges, 1 orphan docs (warning), 0 cycles
Budgets: 1 entrypoints, 1 over limit

Errors (1)
config/example
- AGENTS.md Invalid config.

Warnings (2)
size/max-file-size
- docs/guide.md Too large.
links/broken-links
- README.md:3:2 Broken link.
`);
  });

  it("renders stable json without absolute paths or file text", () => {
    const result = createAuditResult({
      rootPath: "/repo",
      files: [createMarkdownFile("b.md", 2), createMarkdownFile("a.md", 1)],
      findings: [
        {
          ruleId: "warning/rule",
          severity: "warning",
          path: "b.md",
          message: "B warning."
        },
        {
          ruleId: "error/rule",
          severity: "error",
          path: "a.md",
          message: "A error."
        }
      ],
      graph: {
        nodes: [
          { path: "a.md", bytes: 1 },
          { path: "b.md", bytes: 2 }
        ],
        edges: []
      },
      budgets: [createBudget("CLAUDE.md")]
    });

    expect(renderAuditResultJson(result)).toBe(`{
  "summary": {
    "root": "/repo",
    "files": 2,
    "findings": {
      "error": 1,
      "warning": 1,
      "info": 0
    }
  },
  "findings": [
    {
      "ruleId": "error/rule",
      "severity": "error",
      "path": "a.md",
      "message": "A error."
    },
    {
      "ruleId": "warning/rule",
      "severity": "warning",
      "path": "b.md",
      "message": "B warning."
    }
  ],
  "files": [
    {
      "path": "a.md",
      "bytes": 1
    },
    {
      "path": "b.md",
      "bytes": 2
    }
  ],
  "graph": {
    "nodes": [
      {
        "path": "a.md",
        "bytes": 1
      },
      {
        "path": "b.md",
        "bytes": 2
      }
    ],
    "edges": []
  },
  "budgets": [
    {
      "entrypoint": "CLAUDE.md",
      "ownBytes": 10,
      "ownEstimatedTokens": 3,
      "importedFiles": [],
      "totalBytes": 10,
      "totalEstimatedTokens": 3,
      "maxTokens": 5,
      "overLimit": false,
      "cycles": [],
      "missingImports": []
    }
  ]
}
`);
  });
});
