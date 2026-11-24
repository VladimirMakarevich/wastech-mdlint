import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import {
  type GitFixture,
  hasGit,
  isolatedEnv,
  makeRepo,
  tempDir,
} from "../../core/test/support/git-fixture.js";

// `--since` runs git, so these spawn the built bin with the fixture's isolated git environment:
// in-process, git would read the machine's own git configuration, and an `autocrlf` or alias there
// could change what a branch appears to add.
const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));
assertBuilt(BIN, fileURLToPath(new URL("../src/index.ts", import.meta.url)));
assertBuilt(
  fileURLToPath(new URL("../dist/commands.js", import.meta.url)),
  fileURLToPath(new URL("../src/commands.ts", import.meta.url)),
);

const TIMEOUT_MS = 60_000;

function run(
  fixture: { repo: string; env: NodeJS.ProcessEnv },
  args: string[],
) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout.replaceAll("\r\n", "\n"),
    stderr: result.stderr.replaceAll("\r\n", "\n"),
  };
}

// A branch that breaks one link and fixes another, beside a document whose broken link predates it.
async function linkBranch(): Promise<GitFixture> {
  const fixture = await makeRepo();
  await fixture.write(
    "wastech-mdlint.config.json",
    `${JSON.stringify({ rules: [{ rule: "REF-001" }] })}\n`,
  );
  await fixture.write("docs/hub.md", "# Hub\n\n[a](a.md) [b](b.md)\n");
  await fixture.write("docs/a.md", "# A\n\nText.\n");
  await fixture.write("docs/b.md", "# B\n\n[gone](gone.md)\n");
  await fixture.write("docs/old.md", "# Old\n\n[missing](nowhere.md)\n");
  fixture.commit("base");
  fixture.git("checkout", "-q", "-b", "feature");
  await fixture.write("docs/a.md", "# A\n\nText, and [a typo](hbu.md).\n");
  await fixture.write("docs/b.md", "# B\n\n[hub](hub.md)\n");
  return fixture;
}

describe.skipIf(!hasGit)(
  "lint and impact --since (requires git on PATH)",
  () => {
    it(
      "reports and gates on the findings the branch adds, not the ones it inherited",
      async () => {
        const fixture = await linkBranch();
        const text = run(fixture, ["lint", ".", "--since", "main"]);
        expect(text.status).toBe(1);
        expect(text.stdout).toMatch(
          /^since main \(merge-base [0-9a-f]{7}\): 2 changed documents, 1 finding removed\ndocs\/a\.md\n {2}3:11 {2}error {2}.*hbu\.md.* {2}REF-001\n/,
        );
        expect(text.stdout).not.toContain("docs/old.md");

        const json = run(fixture, [
          "lint",
          ".",
          "--since",
          "main",
          "--format",
          "json",
        ]);
        const payload = JSON.parse(json.stdout) as {
          summary: { errors: number };
          messages: { filePath: string }[];
          since: {
            ref: string;
            changed: string[];
            removed: { filePath: string }[];
          };
        };
        expect(payload.summary.errors).toBe(1);
        expect(payload.messages.map((message) => message.filePath)).toEqual([
          "docs/a.md",
        ]);
        expect(payload.since).toMatchObject({
          ref: "main",
          changed: ["docs/a.md", "docs/b.md"],
          removed: [expect.objectContaining({ filePath: "docs/b.md" })],
        });

        // Fixing the new link leaves nothing new: green, although the old finding is still there.
        await fixture.write(
          "docs/a.md",
          "# A\n\nText, and [the hub](hub.md).\n",
        );
        expect(run(fixture, ["lint", ".", "--since", "main"]).status).toBe(0);
        expect(run(fixture, ["lint", "."]).status).toBe(1);
      },
      TIMEOUT_MS,
    );

    it(
      "exits 2 when there is nothing to compare, rather than reporting a clean branch",
      async () => {
        const fixture = await linkBranch();
        const missing = run(fixture, [
          "lint",
          ".",
          "--since",
          "no-such-branch",
        ]);
        expect(missing.status).toBe(2);
        expect(missing.stderr).toContain(
          '"no-such-branch" does not name a commit',
        );

        const outside = await tempDir();
        const plain = run({ repo: outside, env: isolatedEnv(outside) }, [
          "lint",
          ".",
          "--since",
          "main",
        ]);
        expect(plain.status).toBe(2);
        expect(plain.stderr).toContain("not inside a git work tree");

        const withFix = run(fixture, ["lint", ".", "--since", "main", "--fix"]);
        expect(withFix.status).toBe(2);
        expect(withFix.stderr).toContain(
          "--since cannot be combined with --fix.",
        );
      },
      TIMEOUT_MS,
    );

    it(
      "gives the blast radius of every changed document, and takes a file or --since but not both",
      async () => {
        const fixture = await linkBranch();
        const json = run(fixture, [
          "impact",
          "--since",
          "main",
          "--format",
          "json",
        ]);
        expect(json.status).toBe(0);
        const payload = JSON.parse(json.stdout) as Record<string, unknown>;
        expect(payload).toMatchObject({
          files: ["docs/a.md", "docs/b.md"],
          directlyAffected: [{ path: "docs/hub.md", references: 2 }],
          since: { ref: "main" },
        });
        expect(payload).not.toHaveProperty("file");

        const text = run(fixture, ["impact", "--since", "main"]);
        expect(text.stdout).toMatch(
          /^since main \(merge-base [0-9a-f]{7}\): 2 changed documents, 1 finding removed\nchanged files \(2\):\n {2}docs\/a\.md\n {2}docs\/b\.md\ndirectly affected \(1\):\n {2}docs\/hub\.md \(2 references\)\n/,
        );

        expect(run(fixture, ["impact"]).status).toBe(2);
        const both = run(fixture, ["impact", "docs/a.md", "--since", "main"]);
        expect(both.status).toBe(2);
        expect(both.stderr).toContain("not both");
      },
      TIMEOUT_MS,
    );
  },
);
