import { remark } from "remark";
import { describe, expect, it } from "vitest";

import {
  buildAgentRuleMarkdown,
  type AgentRuleParams,
} from "../src/discovery/agent-rule.js";
import { parseDocument } from "../src/markdown/parse-document.js";

const ROOT_INSTALLED: AgentRuleParams = {
  configPath: "wastech-mdlint.config.json",
  cliInstalled: true,
  packageManager: "npm",
  cliVersion: "9.8.7",
};

describe("buildAgentRuleMarkdown", () => {
  it("is deterministic and LF-terminated, with no carriage return anywhere", () => {
    const first = buildAgentRuleMarkdown(ROOT_INSTALLED);
    expect(buildAgentRuleMarkdown(ROOT_INSTALLED)).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
    expect(first).not.toContain("\r");
  });

  it("tells a root config to run from the repository root", () => {
    const text = buildAgentRuleMarkdown(ROOT_INSTALLED);
    expect(text).toContain("`wastech-mdlint.config.json`");
    expect(text).toContain(
      "Run the linter from the repository root, where the config lives: `npx wastech-mdlint lint`.",
    );
  });

  // A nested config is invisible from the repository root, where the page lives and where an agent
  // most likely starts — a bare `lint` there would find no config at all.
  it("names a nested config's directory as the place to run from", () => {
    const text = buildAgentRuleMarkdown({
      ...ROOT_INSTALLED,
      configPath: "docs/wastech-mdlint.config.json",
    });
    expect(text).toContain("`docs/wastech-mdlint.config.json`");
    expect(text).toContain(
      "Run the linter from `docs/`, the directory that holds the config",
    );
  });

  it.each([
    ["npm", "npx wastech-mdlint"],
    ["pnpm", "pnpm exec wastech-mdlint"],
    ["yarn", "yarn wastech-mdlint"],
    ["bun", "bunx wastech-mdlint"],
    [undefined, "npx wastech-mdlint"],
  ] as const)(
    "an installed CLI under %s runs through %s",
    (packageManager, runner) => {
      const text = buildAgentRuleMarkdown({
        ...ROOT_INSTALLED,
        packageManager,
      });
      expect(text).toContain(`\`${runner} lint\``);
      expect(text).toContain(`\`${runner} lint --fix\``);
      expect(text).toContain(`\`${runner} impact <file>\``);
      expect(text).not.toContain("@wastech-mdlint/cli@");
    },
  );

  // Without an install there is no local binary for a package-manager form to resolve, and a bare
  // `npx wastech-mdlint` would ask the registry for a different, unscoped package name.
  it("fetches the pinned release on demand when no CLI is installed", () => {
    const text = buildAgentRuleMarkdown({
      ...ROOT_INSTALLED,
      cliInstalled: false,
      packageManager: "pnpm",
    });
    expect(text).toContain("`npx -y @wastech-mdlint/cli@9.8.7 lint`");
    expect(text).toContain("none was installed when this page was written");
    expect(text).not.toContain("pnpm exec");
  });

  it("pins the companion skill to the CLI version writing the page", () => {
    expect(buildAgentRuleMarkdown(ROOT_INSTALLED)).toContain(
      "`gh skill install VladimirMakarevich/wastech-mdlint wastech-mdlint-docs --pin v9.8.7`",
    );
  });

  // The page lands in a repository this tool knows nothing about, so a relative link would be a
  // broken-link finding the first time the page itself is linted. Read from the parsed document,
  // so a link written in any Markdown form is caught, not only the inline form a regex would see.
  it("carries no relative link, only absolute URLs", () => {
    const document = parseDocument({
      path: ".agents/rules/wastech-mdlint.md",
      content: buildAgentRuleMarkdown(ROOT_INSTALLED),
    });
    expect(document.links.length).toBeGreaterThan(0);
    for (const link of document.links) {
      expect(link.kind).toBe("external");
      expect(link.rawTarget).toMatch(/^https:\/\//);
    }
    expect(document.images).toEqual([]);
    expect(document.imports).toEqual([]);
  });

  // The directory name is the one generated string an arbitrary repository controls, and a code
  // span with a backtick inside closes early — the page would then name a directory that does not
  // exist. Checked against the parser rather than by eye, because the delimiter rule is CommonMark's.
  it("keeps a directory name containing backticks intact inside its code span", () => {
    const directory = "odd `name` dir";
    const tree = remark().parse(
      buildAgentRuleMarkdown({
        ...ROOT_INSTALLED,
        configPath: `${directory}/wastech-mdlint.config.json`,
      }),
    );
    const inlineCode: string[] = [];
    const walk = (node: {
      type: string;
      value?: unknown;
      children?: unknown[];
    }): void => {
      if (node.type === "inlineCode" && typeof node.value === "string") {
        inlineCode.push(node.value);
      }
      for (const child of node.children ?? []) {
        walk(child as typeof node);
      }
    };
    walk(tree);
    expect(inlineCode).toContain(`${directory}/`);
    expect(inlineCode).toContain(`${directory}/wastech-mdlint.config.json`);
  });

  it("rejects a config path containing a line terminator", () => {
    for (const configPath of ["bad\nname/c.json", "bad\rname/c.json"]) {
      expect(() =>
        buildAgentRuleMarkdown({ ...ROOT_INSTALLED, configPath }),
      ).toThrow(TypeError);
    }
  });
});
