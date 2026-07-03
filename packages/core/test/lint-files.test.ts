import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { defineRule, RuleRegistry } from "../src/engine/registry.js";
import { runRules } from "../src/engine/run-rules.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const registry = new RuleRegistry([
  defineRule({
    metadata: {
      id: "TST-001",
      category: "custom",
      description: "flags lines containing BAD",
      defaultSeverity: "error",
      scope: "document",
      fixable: false
    },
    optionsSchema: z.object({}).strict(),
    check: () => (context) => {
      context.document!.content.split("\n").forEach((text, index) => {
        if (text.includes("BAD")) {
          context.report({ message: "line contains BAD", line: index + 1 });
        }
      });
    }
  }),
  defineRule({
    metadata: {
      id: "GRP-001",
      category: "GRP",
      description: "reports once over the corpus",
      defaultSeverity: "warning",
      scope: "project",
      fixable: false
    },
    optionsSchema: z.object({}).strict(),
    check: () => (context) => {
      context.report({
        message: `corpus has ${context.projectFiles!.length} files`,
        line: 0,
        filePath: context.projectFiles![0]
      });
    }
  })
]);

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-lint-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(root, relativePath), content, "utf8");
  }
  return root;
}

function configured(id: string, severity?: ConfiguredRule["severity"]): ConfiguredRule {
  return { rule: registry.resolveRule(id, {}), severity };
}

describe("lintFiles orchestration", () => {
  it("runs document rules per file and a project rule once", async () => {
    const cwd = await fixtureRepo({ "a.md": "ok\nBAD here\n", "b.md": "fine\n" });

    const result = await lintFiles({
      cwd,
      config: { include: ["**/*.md"], rules: [] },
      rules: [configured("TST-001"), configured("GRP-001")],
      settings: {}
    });

    expect(result.messages).toHaveLength(2);
    const document = result.messages.find((message) => message.ruleId === "TST-001");
    expect(document).toMatchObject({ filePath: "a.md", line: 2, severity: "error" });
    const project = result.messages.find((message) => message.ruleId === "GRP-001");
    expect(project).toMatchObject({ filePath: "a.md", severity: "warning" });
  });

  it("applies per-rule severity overrides and drops off rules (R1/C2)", async () => {
    const cwd = await fixtureRepo({ "a.md": "BAD\n" });

    const warned = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [configured("TST-001", "warning")],
      settings: {}
    });
    expect(warned.messages[0]?.severity).toBe("warning");

    const off = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [configured("TST-001", "off")],
      settings: {}
    });
    expect(off.messages).toEqual([]);
  });

  it("suppresses findings via inline-disable directives (block + next-line)", async () => {
    const cwd = await fixtureRepo({
      "block.md": [
        "<!-- wastech-mdlint-disable TST-001 -->",
        "BAD one",
        "<!-- wastech-mdlint-enable TST-001 -->",
        "BAD two"
      ].join("\n"),
      "nextline.md": ["<!-- wastech-mdlint-disable-next-line TST-001 -->", "BAD suppressed", "BAD reported"].join("\n")
    });

    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [configured("TST-001")],
      settings: {}
    });

    // block.md: line 2 suppressed (inside disable range), line 4 reported (after enable).
    // nextline.md: line 2 suppressed, line 3 reported.
    expect(result.messages.map((message) => `${message.filePath}:${message.line}`)).toEqual([
      "block.md:4",
      "nextline.md:3"
    ]);
  });

  it("counts errors and warnings", async () => {
    const cwd = await fixtureRepo({ "a.md": "BAD\n" });
    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [configured("TST-001"), configured("GRP-001")],
      settings: {}
    });
    expect({ errors: result.errorCount, warnings: result.warningCount }).toEqual({ errors: 1, warnings: 1 });
  });
});

describe("runRules fail-fast", () => {
  it("throws when a project rule runs without a documents corpus (R4)", () => {
    const rule = registry.resolveRule("GRP-001", {});
    expect(() =>
      runRules([{ rule }], { settings: {} })
    ).toThrow(/project-scoped but no documents/);
  });
});
