import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-proof-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(root, relativePath), content, "utf8");
  }
  return root;
}

function rule(id: string, options?: unknown): ConfiguredRule {
  return { rule: ruleRegistry.resolveRule(id, options) };
}

describe("REF-001 (proof rule) through the engine", () => {
  it("reports unresolved relative links and passes resolved ones", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[ok](b.md)\n[bad](missing.md)\n",
      "b.md": "# B\n"
    });

    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [rule("REF-001")],
      settings: {}
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "REF-001",
      severity: "error",
      filePath: "a.md",
      line: 2,
      data: { target: "missing.md" }
    });
  });
});

describe("SIZE-001 (proof rule) through the engine", () => {
  it("emits per-metric warn and error findings independently", async () => {
    const cwd = await fixtureRepo({ "big.md": `${"x".repeat(100)}\n` });

    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [rule("SIZE-001", { bytes: { warn: 10, error: 50 } })],
      settings: {}
    });

    // 101 bytes crosses both warn (10) and error (50): both findings appear (P3.07).
    expect(result.messages.map((message) => message.severity).sort()).toEqual(["error", "warning"]);
    expect(result.messages.every((message) => message.data?.metric === "bytes")).toBe(true);
  });

  it("applies glob overrides with per-metric fallback to top-level thresholds", async () => {
    const cwd = await fixtureRepo({ "CLAUDE.md": `${"x".repeat(100)}\n`, "other.md": `${"x".repeat(100)}\n` });

    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [
        rule("SIZE-001", {
          bytes: { error: 1000 },
          overrides: [{ pattern: "CLAUDE.md", bytes: { error: 10 } }]
        })
      ],
      settings: {}
    });

    // Only CLAUDE.md (override error 10) exceeds; other.md (top-level error 1000) does not.
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.filePath).toBe("CLAUDE.md");
  });

  it("lets a config severity override clamp per-finding severity (C2)", async () => {
    const cwd = await fixtureRepo({ "big.md": `${"x".repeat(100)}\n` });

    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [{ rule: ruleRegistry.resolveRule("SIZE-001", { bytes: { error: 10 } }), severity: "warning" }],
      settings: {}
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.severity).toBe("warning");
  });
});
