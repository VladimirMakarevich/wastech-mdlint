import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "@wastech-mdlint/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import { CandidateLinter } from "../src/candidate-lint.js";

// The lint runs in the built worker module, which a worker thread loads with Node's own loader.
assertBuilt(
  fileURLToPath(new URL("../dist/candidate-lint-worker.js", import.meta.url)),
  fileURLToPath(new URL("../src/candidate-lint-worker.ts", import.meta.url)),
);

const documents = new Map([
  [
    "doc.md",
    parseDocument({ path: "doc.md", content: `# Doc\n\n${"a".repeat(40)}!\n` }),
  ],
]);

function configWith(pattern: string): string {
  return JSON.stringify({
    rules: [
      {
        rule: "custom",
        id: "NO-MATCH",
        target: "content",
        options: { assert: { kind: "contentNotMatch", pattern } },
      },
    ],
  });
}

let rootDir: string;
beforeAll(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), "candidate-lint-"));
});
afterAll(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

function job(pattern: string) {
  return {
    rootDir,
    configPath: path.join(rootDir, "wastech-mdlint.config.json"),
    text: configWith(pattern),
    sameScope: true,
    documents,
  };
}

describe("CandidateLinter", () => {
  it("lints the candidate over the documents it is given", async () => {
    const linter = new CandidateLinter();
    try {
      const answer = await linter.lint(job("a{40}"));
      expect(answer).toMatchObject({ ok: true, documentCount: 1 });
      expect(answer.ok && answer.messages.map((m) => m.filePath)).toEqual([
        "doc.md",
      ]);
    } finally {
      await linter.close();
    }
  });

  it("stops a pattern that backtracks without end, keeping the server's thread free, and lints the next one", async () => {
    const linter = new CandidateLinter(5_000);
    try {
      // A timer on this thread fires while the runaway match runs: before, the match ran here and
      // held every timer, request and signal handler until it finished.
      let ticks = 0;
      const ticker = setInterval(() => {
        ticks += 1;
      }, 50);
      const runaway = await linter.lint(job("(a+)+$"));
      clearInterval(ticker);
      expect(runaway).toMatchObject({ ok: false, reason: "timeout" });
      expect(ticks).toBeGreaterThan(20);

      // The stopped thread is replaced, and the documents are sent to the new one.
      expect(await linter.lint(job("a{40}"))).toMatchObject({
        ok: true,
        documentCount: 1,
      });
    } finally {
      await linter.close();
    }
  }, 30_000);
});
