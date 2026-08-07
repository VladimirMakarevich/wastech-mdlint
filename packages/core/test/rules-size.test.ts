import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "../src/config/config-error.js";
import {
  loadConfiguration,
  type ConfiguredRule,
} from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { RuleResolutionError } from "../src/engine/registry.js";
import { ruleRegistry } from "../src/engine/rules/index.js";
import { TOKEN_ESTIMATE_NOTE } from "../src/engine/tokens.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-size-"));
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

describe("SIZE-001 lines metric", () => {
  it("flags a file exceeding the lines error budget", async () => {
    const cwd = await fixtureRepo({ "a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lint(cwd, [rule("SIZE-001", { lines: { error: 2 } })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "error",
      data: { metric: "lines", actual: 4, errorAt: 2 },
    });
  });
});

describe("SIZE-001 tokens metric", () => {
  it("flags a file exceeding the tokens warn budget", async () => {
    const cwd = await fixtureRepo({ "a.md": `${"x".repeat(40)}\n` });
    const result = await lint(cwd, [rule("SIZE-001", { tokens: { warn: 5 } })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "warning",
      data: { metric: "tokens", actual: 11, warnAt: 5 },
    });
  });

  // W-34: the number is an estimate, and the message is the only place a reader of it will look.
  it("discloses the token calibration in the message itself", async () => {
    const cwd = await fixtureRepo({ "a.md": `${"x".repeat(40)}\n` });
    const result = await lint(cwd, [rule("SIZE-001", { tokens: { warn: 5 } })]);
    expect(result.messages[0]!.message).toBe(
      `File exceeds tokens warn budget: 11 tokens > 5. ${TOKEN_ESTIMATE_NOTE}`,
    );
  });

  // The exact-count metrics stay terse: a byte or line count needs no calibration, and appending one
  // to all three would train readers to skip the sentence that matters.
  it("leaves the exact-count metrics' messages unchanged", async () => {
    const cwd = await fixtureRepo({ "a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", { lines: { warn: 2 }, bytes: { warn: 3 } }),
    ]);
    for (const message of result.messages) {
      expect(message.message).not.toContain(TOKEN_ESTIMATE_NOTE);
    }
    expect(result.messages.map((message) => message.message)).toContain(
      "File exceeds lines warn budget: 4 lines > 2.",
    );
  });
});

describe("SIZE-001 pass case", () => {
  it("reports nothing when every configured metric stays under budget", async () => {
    const cwd = await fixtureRepo({ "a.md": "short\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", {
        bytes: { warn: 1000 },
        lines: { warn: 100 },
        tokens: { warn: 100 },
      }),
    ]);
    expect(result.messages).toEqual([]);
  });
});

describe("SIZE-001 threshold supersession (P11.13 / SC-2)", () => {
  it("reports one error finding, carrying both thresholds, when a metric crosses warn and error", async () => {
    const cwd = await fixtureRepo({ "a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", { lines: { warn: 2, error: 3 } }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "error",
      message: "File exceeds lines error budget: 4 lines > 3.",
      // The suppressed warn finding is lossless: `data` still names the crossed warn threshold.
      data: { metric: "lines", actual: 4, warnAt: 2, errorAt: 3 },
    });
  });

  it("reports one finding under a severity override that would collapse warn and error to the same severity", async () => {
    const cwd = await fixtureRepo({ "a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [
        {
          rule: ruleRegistry.resolveRule("SIZE-001", {
            lines: { warn: 2, error: 3 },
          }),
          severity: "error",
        },
      ],
      settings: {},
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.severity).toBe("error");
  });

  it("still evaluates each metric independently", async () => {
    const cwd = await fixtureRepo({ "a.md": `${"x".repeat(40)}\nl2\n` });
    const result = await lint(cwd, [
      rule("SIZE-001", { lines: { error: 1 }, tokens: { warn: 5 } }),
    ]);
    expect(
      result.messages.map((message) => [
        message.data?.metric,
        message.severity,
      ]),
    ).toEqual([
      ["lines", "error"],
      ["tokens", "warning"],
    ]);
  });
});

// W-04: `{"rule":"SIZE-001"}` used to be a valid, enabled rule that measured nothing — the only rule
// in the registry that could be enabled into inertness.
describe("SIZE-001 requires at least one budget (P13.04 / W-04)", () => {
  function resolutionError(options: unknown): RuleResolutionError {
    let thrown: unknown;
    try {
      ruleRegistry.resolveRule("SIZE-001", options);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleResolutionError);
    return thrown as RuleResolutionError;
  }

  it.each([{}, undefined])(
    "rejects an empty options object with a diagnostic naming all three metrics",
    (options) => {
      const error = resolutionError(options);
      expect(error.code).toBe("INVALID_OPTIONS");
      const message = JSON.stringify(error.issues);
      for (const metric of ["bytes", "lines", "tokens"]) {
        expect(message).toContain(metric);
      }
    },
  );

  it("accepts an overrides-only config, which does measure the files its patterns match", async () => {
    const cwd = await fixtureRepo({ "special/a.md": "l1\nl2\nl3\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", {
        overrides: [{ pattern: "special/**", lines: { error: 1 } }],
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      metric: "lines",
      errorAt: 1,
    });
  });

  it("rejects a named metric with no warn or error, the same defect one level down", () => {
    const error = resolutionError({ bytes: {} });
    expect(error.code).toBe("INVALID_OPTIONS");
    expect(JSON.stringify(error.issues)).toContain("bytes");
  });

  // The acceptance criterion at the config boundary: a bare entry fails the load with a path-anchored
  // CONFIG_INVALID rather than producing a silent clean run.
  it("fails config loading with CONFIG_INVALID naming the offending rule entry", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "SIZE-001" }],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(
      /rules\[0\]\.options:.*bytes, lines, or tokens/,
    );
  });
});

describe("SIZE-001 overrides", () => {
  it("uses the first matching override in list order when multiple patterns match", async () => {
    const cwd = await fixtureRepo({ "special/a.md": `${"x".repeat(100)}\n` });
    const result = await lint(cwd, [
      rule("SIZE-001", {
        bytes: { error: 1000 },
        overrides: [
          { pattern: "special/**", bytes: { error: 10 } },
          { pattern: "**/*.md", bytes: { error: 20 } },
        ],
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({ errorAt: 10 });
  });

  it("falls back to the top-level threshold for a metric the matching override omits", async () => {
    const cwd = await fixtureRepo({ "special/a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", {
        lines: { error: 2 },
        overrides: [{ pattern: "special/**", bytes: { error: 999999 } }],
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      metric: "lines",
      errorAt: 2,
    });
  });
});
