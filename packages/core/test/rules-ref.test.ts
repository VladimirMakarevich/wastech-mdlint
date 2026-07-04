import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-ref-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

function rule(id: string, options?: unknown): ConfiguredRule {
  return { rule: ruleRegistry.resolveRule(id, options) };
}

async function lint(cwd: string, rules: ConfiguredRule[]) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings: {} });
}

describe("REF-002 anchors", () => {
  it("flags anchors that match no heading slug (same-file and cross-file)", async () => {
    const cwd = await fixtureRepo({
      "a.md": "## Intro\n\n[self](#intro)\n[bad](#nope)\n[cross](b.md#overview)\n[crossbad](b.md#missing)\n",
      "b.md": "## Overview\n"
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(result.messages.map((message) => message.data?.anchor).sort()).toEqual(["missing", "nope"]);
  });
});

describe("REF-003 images", () => {
  it("flags missing images and skips external ones", async () => {
    const cwd = await fixtureRepo({
      "a.md": "![real](real.png)\n![missing](missing.png)\n![ext](https://x/y.png)\n"
    });
    await writeFile(path.join(cwd, "real.png"), "x", "utf8");

    const result = await lint(cwd, [rule("REF-003")]);
    expect(result.messages.map((message) => message.data?.target)).toEqual(["missing.png"]);
  });
});

describe("REF-004 cross-zone links", () => {
  it("flags undeclared cross-zone links and allows declared ones", async () => {
    const cwd = await fixtureRepo({
      "zones/auth/page.md": "## Dependencies\n\n- billing\n\n## Body\n\n[bill](../billing/x.md)\n[pay](../payments/y.md)\n",
      "zones/billing/x.md": "# x\n",
      "zones/payments/y.md": "# y\n"
    });
    const result = await lint(cwd, [rule("REF-004", { zonesDir: "zones" })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({ fromZone: "auth", toZone: "payments" });
  });
});

describe("REF-005 ID traceability", () => {
  it("reports dangling references (error) and orphan definitions (warning)", async () => {
    const cwd = await fixtureRepo({
      "reqs.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-2 |\n",
      "design.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-9 |\n"
    });
    const result = await lint(cwd, [
      rule("REF-005", {
        definitions: ["reqs.md"],
        references: ["design.md"],
        idColumn: "ID",
        idPattern: "^REQ-\\d+$"
      })
    ]);

    const dangling = result.messages.find((message) => message.severity === "error");
    const orphan = result.messages.find((message) => message.severity === "warning");
    expect(dangling).toMatchObject({ filePath: "design.md", data: { id: "REQ-9" } });
    expect(orphan).toMatchObject({ filePath: "reqs.md", data: { id: "REQ-2" } });
  });
});

describe("REF-006 stability consistency", () => {
  it("warns when an entry depends on a less-stable entity", async () => {
    const cwd = await fixtureRepo({
      "defs.md": "| ID | Stability |\n| --- | --- |\n| A | stable |\n| B | experimental |\n",
      "refs.md": "| ID | Stability |\n| --- | --- |\n| B | stable |\n"
    });
    const result = await lint(cwd, [
      rule("REF-006", {
        stabilityColumn: "Stability",
        stabilityOrder: ["experimental", "stable"],
        definitions: ["defs.md"],
        references: ["refs.md"],
        idColumn: "ID"
      })
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "warning",
      data: { referencedId: "B", referencedStability: "experimental", referencerStability: "stable" }
    });
  });
});
