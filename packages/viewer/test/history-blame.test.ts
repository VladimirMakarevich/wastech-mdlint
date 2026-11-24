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

assertBuilt(
  fileURLToPath(new URL("../dist/client/history.js", import.meta.url)),
  fileURLToPath(new URL("../src/client/history.ts", import.meta.url)),
);

function get(
  port: number,
  rawPath: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path: rawPath },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (body += chunk));
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, body }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

const articleOf = (body: string) =>
  /<article class="markdown-body[^"]*">[\s\S]*<\/article>/.exec(body)?.[0] ??
  "";

describe.skipIf(!hasGit)("history and blame (requires git on PATH)", () => {
  let fixture: GitFixture;
  let viewer: RunningViewer;
  let port: number;

  beforeAll(async () => {
    fixture = await makeRepo();
    await fixture.write("README.md", "# Fixture\n");
    await fixture.write(
      "docs/guide.md",
      "# Guide\n\nFirst paragraph.\n\nSecond paragraph.\n",
    );
    fixture.commit("Write the guide");
    fixture.git("checkout", "-q", "-b", "feature");
    await fixture.write(
      "docs/guide.md",
      "# Guide\n\nFirst paragraph.\n\nSecond paragraph, reworded.\n",
    );
    fixture.commit("Reword the second paragraph");
    await fixture.write(
      "docs/guide.md",
      "# Guide\n\nFirst paragraph, not committed.\n\nSecond paragraph, reworded.\n",
    );
    viewer = await startViewer({
      cwd: fixture.repo,
      host: "127.0.0.1",
      port: 0,
      portExplicit: true,
      watch: false,
      gitEnv: fixture.env,
    });
    port = Number(new URL(viewer.url).port);
  }, 60_000);

  afterAll(async () => {
    await viewer?.close();
  });

  it("lists the commits that touched a document, newest first, with the author on loopback", async () => {
    const answer = await get(port, "/api/history?path=docs/guide.md");
    expect(answer.status).toBe(200);
    const payload = JSON.parse(answer.body) as {
      path: string;
      commits: { subject: string; author?: string; date: string }[];
    };
    expect(payload.path).toBe("docs/guide.md");
    expect(payload.commits.map((commit) => commit.subject)).toEqual([
      "Reword the second paragraph",
      "Write the guide",
    ]);
    expect(payload.commits[0]?.author).toBe("Fixture");
    expect((await get(port, "/api/history?path=../secret.md")).status).toBe(
      404,
    );
    // The banner carries the place to show it, hidden until its script runs.
    expect((await get(port, "/doc/docs/guide.md")).body).toContain(
      '<details class="changes-history" hidden data-path="docs/guide.md"><summary>History</summary>',
    );
    // A document the branch left alone has no banner, and carries the same place on its own.
    const unchanged = articleOf((await get(port, "/doc/README.md")).body);
    expect(unchanged).not.toContain("changes-banner");
    expect(unchanged).toContain(
      '<div class="document-history"><details class="changes-history" hidden data-path="README.md"><summary>History</summary>',
    );
    const commits = JSON.parse(
      (await get(port, "/api/history?path=README.md")).body,
    ) as { commits: { subject: string }[] };
    expect(commits.commits.map((commit) => commit.subject)).toEqual([
      "Write the guide",
    ]);
  });

  it("draws who last changed each block in the margin only when asked", async () => {
    const plain = await get(port, "/doc/docs/guide.md");
    expect(articleOf(plain.body)).not.toContain("data-blame");
    expect(plain.body).toContain(
      '<a class="blame-toggle" href="/doc/docs/guide.md?blame=1" aria-pressed="false"',
    );

    const blamed = await get(port, "/doc/docs/guide.md?blame=1");
    const article = articleOf(blamed.body);
    expect(article).toContain('class="markdown-body has-blame"');
    expect(article).toMatch(
      /<h1 [^>]*data-blame="[0-9a-f]{7} \d{4}-\d{2}-\d{2}" title="[0-9a-f]{7} · \d{4}-\d{2}-\d{2} · Fixture — Write the guide"/,
    );
    expect(article).toMatch(
      /data-blame="uncommitted" title="Not committed yet"[^>]*>First paragraph, not committed\./,
    );
    expect(article).toMatch(
      /title="[^"]*Reword the second paragraph"[^>]*>Second paragraph, reworded\./,
    );
    expect(blamed.body).toContain(
      '<a class="blame-toggle" href="/doc/docs/guide.md" aria-pressed="true"',
    );
  });
});
