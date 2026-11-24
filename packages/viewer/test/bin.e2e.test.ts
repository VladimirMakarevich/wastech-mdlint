import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";

// The in-process suites call `startViewer` directly and never run `src/index.ts`, which is where the
// command line is parsed, the bad-directory check happens and the URL is printed. These tests spawn
// the built bin the way a user's shell would, so what they prove is what a user sees.

const binPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
assertBuilt(
  binPath,
  fileURLToPath(new URL("../src/index.ts", import.meta.url)),
);

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url));

describe("wastech-mdlint-viewer bin", () => {
  it("prints the address it serves, and that address answers", async () => {
    const child = spawn(
      process.execPath,
      [binPath, fixtureRoot, "--port", "0", "--no-watch"],
      { windowsHide: true },
    );
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          output += chunk;
          const match = /at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
          if (match !== null) {
            resolve(match[1]!);
          }
        });
        child.on("exit", (code) =>
          reject(new Error(`exited ${String(code)} before serving`)),
        );
      });
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const response = await fetch(new URL("doc/README.md", url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Fixture home");
    } finally {
      child.kill();
    }
  }, 30_000);

  it("refuses a directory that does not exist, naming it as typed", () => {
    const result = spawnSync(process.execPath, [binPath, "no-such-directory"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      "wastech-mdlint-viewer: not a directory: no-such-directory\n",
    );
  });

  it("refuses an invalid port with usage help", () => {
    const result = spawnSync(
      process.execPath,
      [binPath, ".", "--port", "eighty"],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Invalid port: eighty");
    expect(result.stderr).toContain("Usage: wastech-mdlint-viewer");
  });
});
