import { request } from "node:http";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import {
  type GitFixture,
  hasGit,
  makeRepo,
} from "../../core/test/support/git-fixture.js";
import { startViewer, type RunningViewer } from "../src/server.js";
import { isRefChange } from "../src/watch.js";

assertBuilt(
  fileURLToPath(new URL("../dist/client/live-reload.js", import.meta.url)),
  fileURLToPath(new URL("../src/client/live-reload.ts", import.meta.url)),
);

describe("isRefChange", () => {
  it.each([
    ["HEAD", true],
    ["packed-refs", true],
    ["refs/heads/main", true],
    ["refs/remotes/origin/main", true],
    ["HEAD.lock", false],
    ["refs/heads/main.lock", false],
    ["index", false],
    ["objects/ab/cdef", false],
    ["ORIG_HEAD", false],
  ])("%s → %s", (relPath, expected) => {
    expect(isRefChange(relPath)).toBe(expected);
  });
});

// The server's event stream as a page holds it open: every named event it sends, in order.
function listen(port: number): { events: string[]; close(): void } {
  const events: string[] = [];
  const outgoing = request(
    { host: "127.0.0.1", port, path: "/events" },
    (incoming) => {
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => {
        for (const match of chunk.matchAll(/^event: (\S+)$/gm)) {
          events.push(match[1]!);
        }
      });
    },
  );
  outgoing.on("error", () => undefined);
  outgoing.end();
  return { events, close: () => outgoing.destroy() };
}

async function until(
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

describe.skipIf(!hasGit)("watching git's refs (requires git on PATH)", () => {
  let fixture: GitFixture;
  let viewer: RunningViewer;
  let port: number;

  beforeAll(async () => {
    fixture = await makeRepo();
    await fixture.write("README.md", "# Fixture\n");
    await fixture.write("docs/guide.md", "# Guide\n\nOld.\n");
    fixture.commit("base");
    fixture.git("checkout", "-q", "-b", "feature");
    await fixture.write("docs/guide.md", "# Guide\n\nNew.\n");
    viewer = await startViewer({
      cwd: fixture.repo,
      host: "127.0.0.1",
      port: 0,
      portExplicit: true,
      watch: true,
      gitEnv: fixture.env,
    });
    port = Number(new URL(viewer.url).port);
  }, 60_000);

  afterAll(async () => {
    await viewer?.close();
  });

  // A commit moves HEAD without changing a file of the work tree, so the corpus watcher sees nothing;
  // only the ref watcher can tell an open Changes page. A branch that is neither HEAD nor the base
  // moving changes no review, and must not reload every page.
  it("tells open pages when HEAD moves, and not when an unrelated branch does", async () => {
    const stream = listen(port);
    try {
      // Let the stream connect, and the work-tree edit made before startup settle, before acting.
      await new Promise((resolve) => setTimeout(resolve, 500));
      stream.events.length = 0;

      fixture.git("branch", "elsewhere");
      expect(await until(() => stream.events.includes("git"), 1_500)).toBe(
        false,
      );

      fixture.git("add", "-A");
      fixture.git("commit", "-q", "-m", "commit the edit");
      expect(await until(() => stream.events.includes("git"), 10_000)).toBe(
        true,
      );
    } finally {
      stream.close();
    }
  }, 30_000);
});
