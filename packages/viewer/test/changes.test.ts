import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { request } from "node:http";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import {
  type GitFixture,
  hasGit,
  makeRepo,
} from "../../core/test/support/git-fixture.js";
import { parseCliArgs } from "../src/cli-args.js";
import { startViewer, type RunningViewer } from "../src/server.js";

// The server loads from source here, but the page script it serves is only ever compiled output, and
// the bin test below spawns the compiled entrypoint.
assertBuilt(
  fileURLToPath(new URL("../dist/client/viewer.js", import.meta.url)),
  fileURLToPath(new URL("../src/client/viewer.ts", import.meta.url)),
);
const binPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
assertBuilt(
  binPath,
  fileURLToPath(new URL("../src/index.ts", import.meta.url)),
);

type Response = { status: number; body: string };

function get(port: number, rawPath: string): Promise<Response> {
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

const portOf = (viewer: RunningViewer) => Number(new URL(viewer.url).port);

type ChangedDocument = {
  path: string;
  oldPath?: string;
  status: string;
  eager: boolean;
  reach: number;
  added: number;
  removed: number;
  anchor: string;
};

type ChangesPayload = {
  status: string;
  base: { ref: string; commit: string };
  mergeBase: string;
  worktree: boolean;
  added: number;
  removed: number;
  config: { path: string; status: string } | null;
  documents: ChangedDocument[];
  outsideCorpus: { status: string; path: string }[];
};

const CONFIG = (maxTokens: number) =>
  `${JSON.stringify(
    {
      include: ["**/*.md"],
      exclude: ["drafts/**"],
      rules: [
        {
          rule: "LLM-001",
          options: {
            entrypoints: ["CLAUDE.md"],
            maxTokensPerEntrypoint: maxTokens,
          },
        },
      ],
    },
    null,
    2,
  )}\n`;

// A repository on a feature branch. Committed: an edit to a style guide CLAUDE.md eagerly imports, an
// edit to a hub two guides link to, a deleted document. Uncommitted: a new document, an edited draft
// the config excludes, and a config change.
async function featureBranch(): Promise<GitFixture> {
  const fixture = await makeRepo();
  await fixture.write("wastech-mdlint.config.json", CONFIG(100000));
  await fixture.write("README.md", "# Fixture\n\n[Guide](docs/guide.md)\n");
  await fixture.write("CLAUDE.md", "# Agent rules\n\n@rules/style.md\n");
  await fixture.write(
    "rules/style.md",
    "# Style\n\nWrite short sentences in the present tense.\n",
  );
  await fixture.write("docs/guide.md", "# Guide\n\nSee [the hub](hub.md).\n");
  await fixture.write("docs/other.md", "# Other\n\nSee [the hub](hub.md).\n");
  await fixture.write(
    "docs/hub.md",
    "# Hub\n\n| Name | Value |\n| ---- | ----- |\n| a    | 1     |\n",
  );
  await fixture.write("docs/old.md", "# Old\n\nGoing away.\n");
  await fixture.write("drafts/idea.md", "# Idea\n");
  fixture.commit("base");

  fixture.git("checkout", "-q", "-b", "feature");
  await fixture.write(
    "rules/style.md",
    "# Style\n\nWrite short sentences in the past tense.\n",
  );
  await fixture.write(
    "docs/hub.md",
    "# Hub\n\n| Name | Value  |\n| ---- | ------ |\n| a    | 200000 |\n",
  );
  fixture.git("rm", "-q", "docs/old.md");
  fixture.commit("feature work");

  await fixture.write("docs/new.md", "# New\n\nFresh <text> & more.\n");
  await fixture.write("drafts/idea.md", "# Idea, edited\n");
  await fixture.write("wastech-mdlint.config.json", CONFIG(200000));
  return fixture;
}

describe("parseCliArgs", () => {
  it("takes the base to compare with", () => {
    expect(parseCliArgs(["--base", "develop"])).toMatchObject({
      kind: "run",
      base: "develop",
    });
  });
});

describe.skipIf(!hasGit)("the Changes section (requires git on PATH)", () => {
  let fixture: GitFixture;
  let viewer: RunningViewer;
  let port: number;

  beforeAll(async () => {
    fixture = await featureBranch();
    viewer = await startViewer({
      cwd: fixture.repo,
      host: "127.0.0.1",
      port: 0,
      portExplicit: true,
      watch: false,
      gitEnv: fixture.env,
    });
    port = portOf(viewer);
  }, 60_000);

  afterAll(async () => {
    await viewer?.close();
  });

  it("adds Changes to the header, between Dashboard and Config, on every page alike", async () => {
    const headers = new Set<string>();
    for (const address of [
      "/graph",
      "/dashboard",
      "/changes",
      "/config",
      "/doc/README.md",
    ]) {
      // The one permitted difference between pages: which link is marked current, and the graph
      // link, which focuses the document a document page shows.
      const header = (
        /<header[\s\S]*?<\/header>/.exec(
          (await get(port, address)).body,
        )?.[0] ?? ""
      )
        .replace(' aria-current="page"', "")
        .replace(/<a class="segment" href="\/graph[^"]*"/, "");
      expect(header, address).toContain(
        '<a class="segment" href="/dashboard">Dashboard</a><a class="segment" href="/changes">Changes</a><a class="segment" href="/config">Config</a>',
      );
      // A document page also names its file in the bar; the section pages share one header.
      if (!address.startsWith("/doc/")) {
        headers.add(header);
      }
    }
    expect(headers.size).toBe(1);
    expect(viewer.notices).toEqual([]);
  });

  it("puts a hidden changed-files switch above the tree", async () => {
    const { body } = await get(port, "/doc/README.md");
    expect(body).toContain(
      '<label class="tree-filter tree-filter-changes switch-row" hidden><span>Only changed files</span>',
    );
  });

  // @boundary-guard host-parity
  // The page and `/api/changes` describe one review: the page's list is read back from its text and
  // compared with the JSON, so a count or an order computed twice cannot drift apart unseen.
  it("lists the changed documents most influential first, and the API lists the same", async () => {
    const { status, body } = await get(port, "/changes");
    expect(status).toBe(200);
    const api = JSON.parse(
      (await get(port, "/api/changes")).body,
    ) as ChangesPayload;
    expect(api.status).toBe("ready");
    expect(api.base.ref).toBe("main");
    expect(api.worktree).toBe(true);

    // The page's list, read back from its text rather than recomputed: letter, path, counts.
    const list =
      /<nav class="changes-files"[\s\S]*?<\/nav>/.exec(body)?.[0] ?? "";
    const rows = [
      ...list.matchAll(
        /<li><span class="change-status[^"]*"[^>]*>([AMDR])<\/span> <a href="[^"]*">([^<]+)<\/a> <span class="change-stats">\+(\d+) −(\d+)<\/span>/g,
      ),
    ].map((match) => ({
      status: match[1],
      path: match[2],
      added: Number(match[3]),
      removed: Number(match[4]),
    }));
    expect(rows).toEqual(
      api.documents.map(({ status, path, added, removed }) => ({
        status,
        path,
        added,
        removed,
      })),
    );
    expect(rows.map((row) => `${row.status} ${row.path}`)).toEqual([
      "M rules/style.md",
      "M docs/hub.md",
      "A docs/new.md",
      "D docs/old.md",
    ]);
    expect(api.documents[0]).toMatchObject({ eager: true });
    expect(api.documents[1]).toMatchObject({ eager: false, reach: 3 });
  });

  it("shows the config change first and counts Markdown the corpus leaves out", async () => {
    const { body } = await get(port, "/changes");
    const api = JSON.parse(
      (await get(port, "/api/changes")).body,
    ) as ChangesPayload;
    expect(api.config).toMatchObject({
      path: "wastech-mdlint.config.json",
      status: "M",
    });
    expect(api.outsideCorpus).toEqual([
      { status: "M", path: "drafts/idea.md" },
    ]);
    expect(body).toContain(
      "<summary>1 Markdown file changed outside the corpus</summary>",
    );
    const firstCard = body.indexOf('<section class="change-card"');
    expect(body.slice(firstCard, firstCard + 200)).toContain(
      'id="change.wastech-mdlint.config.json"',
    );
  });

  it("highlights the changed word and the changed table cell, escaping the text", async () => {
    const { body } = await get(port, "/changes");
    expect(body).toContain("<del>present</del>");
    expect(body).toContain("<ins>past</ins>");
    // The hub's table was realigned around one new value: only that cell is marked.
    expect(body).toContain("<del> 1     </del>");
    expect(body).toContain("<ins> 200000 </ins>");
    expect(body).not.toMatch(/<(del|ins)> Value/);
    expect(body).toContain("Fresh &#x3C;text> &#x26; more.");
  });

  it("links each changed document to its page, but not a deleted one", async () => {
    const { body } = await get(port, "/changes");
    expect(body).toContain(
      '<a class="change-path" href="/doc/docs/hub.md">docs/hub.md</a>',
    );
    expect(body).toContain('<span class="change-path">docs/old.md</span>');
  });

  it("answers one document's diff, and nothing for a path outside the review", async () => {
    const answer = JSON.parse(
      (await get(port, "/api/changes/diff?path=rules%2Fstyle.md")).body,
    ) as { status: string; diff: { added: number; removed: number } };
    expect(answer).toMatchObject({
      status: "M",
      diff: { added: 1, removed: 1 },
    });
    for (const path of ["README.md", "../etc/passwd", "drafts/idea.md", ""]) {
      expect(
        (await get(port, `/api/changes/diff?path=${encodeURIComponent(path)}`))
          .status,
        path,
      ).toBe(404);
    }
  });

  it("leaves uncommitted work out when asked for commits only", async () => {
    const api = JSON.parse(
      (await get(port, "/api/changes?worktree=0")).body,
    ) as ChangesPayload;
    expect(api.worktree).toBe(false);
    expect(api.config).toBeNull();
    expect(api.outsideCorpus).toEqual([]);
    expect(api.documents.map((entry) => entry.path)).toEqual([
      "rules/style.md",
      "docs/hub.md",
      "docs/old.md",
    ]);
    const { body } = await get(port, "/changes?worktree=0");
    expect(body).toContain(
      '<a class="segment" href="/changes?worktree=0" aria-current="page">Commits only</a>',
    );
  });

  it("notices a new commit without the work tree changing", async () => {
    fixture.git("add", "docs/new.md");
    fixture.git("commit", "-q", "-m", "add new");
    const api = JSON.parse(
      (await get(port, "/api/changes?worktree=0")).body,
    ) as ChangesPayload;
    expect(api.documents.map((entry) => entry.path)).toContain("docs/new.md");
  });
});

describe.skipIf(!hasGit)(
  "Changes without a base (requires git on PATH)",
  () => {
    it("says why at startup and on the page, and serves everything else", async () => {
      const fixture = await featureBranch();
      const viewer = await startViewer({
        cwd: fixture.repo,
        host: "127.0.0.1",
        port: 0,
        portExplicit: true,
        watch: false,
        base: "no-such-branch",
        gitEnv: fixture.env,
      });
      try {
        const port = portOf(viewer);
        expect(viewer.notices).toEqual([
          'changes: "no-such-branch" does not name a commit in this repository. Check the name, or fetch the branch first.',
        ]);
        const page = await get(port, "/changes");
        expect(page.status).toBe(200);
        expect(page.body).toContain(
          '<p class="changes-unavailable">"no-such-branch" does not name a commit in this repository.</p>',
        );
        expect(
          JSON.parse((await get(port, "/api/changes")).body),
        ).toMatchObject({ status: "unavailable", reason: "base-not-found" });
        expect((await get(port, "/doc/README.md")).status).toBe(200);
      } finally {
        await viewer.close();
      }
    }, 60_000);
  },
);

describe.skipIf(!hasGit)("the bin with --base (requires git on PATH)", () => {
  // @boundary-guard installed-bin-spawn
  // A `--base` that names nothing must reach the user as a line on stderr from the process they
  // started, and must not stop the viewer: an in-process call cannot show either.
  it("prints a base that names nothing and still serves", async () => {
    const fixture = await featureBranch();
    const child = spawn(
      process.execPath,
      [
        binPath,
        fixture.repo,
        "--port",
        "0",
        "--no-watch",
        "--base",
        "no-such-branch",
      ],
      { windowsHide: true, env: fixture.env },
    );
    try {
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
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
      const response = await fetch(new URL("changes", url));
      expect(response.status).toBe(200);
      expect(stderr).toContain(
        'wastech-mdlint-viewer: changes: "no-such-branch" does not name a commit in this repository.',
      );
    } finally {
      child.kill();
      await rm(fixture.dir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }, 60_000);
});
