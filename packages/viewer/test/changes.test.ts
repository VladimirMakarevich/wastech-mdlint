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
import { ChangeTracker } from "../src/changes.js";
import { parseCliArgs } from "../src/cli-args.js";
import { Corpus } from "../src/corpus.js";
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

// A branch that edits a paragraph in one section of a document, removes a list item from another and
// leaves a third alone, and adds a document of its own.
async function documentBranch(): Promise<GitFixture> {
  const fixture = await makeRepo();
  const page = [
    "---",
    "title: Page",
    "---",
    "",
    "# Page",
    "",
    "## Intro",
    "",
    "Write in the present tense.",
    "",
    "## Steps",
    "",
    "- one",
    "- two",
    "- three",
    "",
    "## Unchanged",
    "",
    "Nothing here moves.",
    "",
  ].join("\n");
  await fixture.write("README.md", "# Fixture\n\nUnchanged.\n");
  await fixture.write("docs/page.md", page);
  fixture.commit("base");
  fixture.git("checkout", "-q", "-b", "feature");
  await fixture.write(
    "docs/page.md",
    page.replace("present tense", "past tense").replace("- two\n", ""),
  );
  await fixture.write("docs/added.md", "# Added\n\nAll new.\n");
  fixture.commit("feature work");
  return fixture;
}

const articleOf = (body: string) =>
  /<article class="markdown-body">[\s\S]*<\/article>/.exec(body)?.[0] ?? "";

describe.skipIf(!hasGit)(
  "a changed document's page (requires git on PATH)",
  () => {
    let fixture: GitFixture;
    let viewer: RunningViewer;
    let port: number;

    beforeAll(async () => {
      fixture = await documentBranch();
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

    // What the server sends is what a reader without script sees, and what is on screen before any
    // script has run, so nothing moves once the page has loaded.
    it("marks the changed blocks and puts back the removed one in the HTML it serves", async () => {
      const { status, body } = await get(port, "/doc/docs/page.md");
      expect(status).toBe(200);
      const article = articleOf(body);
      expect(article).toMatch(
        /<p data-line="9" data-line-end="9" data-change="changed" data-change-hunks="0">Write in the past tense\.<\/p>/,
      );
      expect(article).toMatch(
        /<li data-line="13" data-line-end="13">one<\/li>\s*<li class="change-removed-item"><details class="change-removed"><summary>1 list item removed<\/summary><div class="change-removed-body"><ul><li>two<\/li><\/ul><\/div><\/details><\/li><li data-line="14"/,
      );
      // The paragraph and the list item sit in one hunk, which the template holds for the bar.
      expect(article).toMatch(
        /<template class="change-hunks"><div class="change-hunk" data-hunk="0">/,
      );
      expect(article).not.toContain('data-hunk="1"');
    });

    it("says above the text what changed, with the views one click apart", async () => {
      const { body } = await get(port, "/doc/docs/page.md");
      const article = articleOf(body);
      expect(article.indexOf('<div class="changes-banner">')).toBeLessThan(
        article.indexOf('<section class="frontmatter"'),
      );
      expect(article).toContain(
        '<span class="changes-banner-text">Modified in this branch · +1 −2</span>',
      );
      expect(article).toContain(
        '<a class="segment" href="/doc/docs/page.md" aria-current="page">Rendered</a><a class="segment" href="/doc/docs/page.md?diff=source">Source</a><a class="segment" href="/doc/docs/page.md?diff=off">Off</a>',
      );
      expect(article).toContain(
        '<a class="changes-banner-link" href="/changes#change.docs%2Fpage.md">Changes page</a>',
      );
    });

    it("marks the changed sections in the outline, and only those", async () => {
      const { body } = await get(port, "/doc/docs/page.md");
      const outline =
        /<nav class="outline"[\s\S]*?<\/nav>/.exec(body)?.[0] ?? "";
      const changed = [
        ...outline.matchAll(
          /<a href="#([^"]+)">[^<]*(<span class="outline-change")?/g,
        ),
      ].map((match) => `${match[1]}${match[2] === undefined ? "" : " *"}`);
      expect(changed).toEqual(["intro *", "steps *", "unchanged"]);
    });

    it("shows the source diff in place of the text with ?diff=source", async () => {
      const { body } = await get(port, "/doc/docs/page.md?diff=source");
      const article = articleOf(body);
      expect(article).toContain(
        '<a class="segment" href="/doc/docs/page.md?diff=source" aria-current="page">Source</a>',
      );
      expect(article).toMatch(
        /<div class="change-source"><div class="diff-wrap"><table class="diff">/,
      );
      expect(article).toContain("<del>present</del>");
      expect(article).not.toContain("data-change");
      expect(article).not.toContain('class="frontmatter"');
      expect(body).not.toContain('<nav class="outline"');
    });

    it("leaves the text unmarked with ?diff=off, the switch still there", async () => {
      const { body } = await get(port, "/doc/docs/page.md?diff=off");
      const article = articleOf(body);
      expect(article).toContain(
        '<a class="segment" href="/doc/docs/page.md?diff=off" aria-current="page">Off</a>',
      );
      expect(article).toContain("Write in the past tense.");
      expect(article).not.toContain("data-change");
      expect(article).not.toContain("change-removed");
      expect(article).not.toContain("change-hunks");
      expect(body).not.toContain("outline-change");
    });

    it("leaves an unchanged document's page as it was", async () => {
      const { body } = await get(port, "/doc/README.md");
      expect(body).not.toContain("changes-banner");
      expect(body).not.toContain("data-change");
      expect(body).not.toContain("change-hunks");
    });

    // After a save the reloading page, every open page's script and every other tab ask at once; they
    // must share one review, and one that was running when the files changed must not be kept.
    it("shares a running review between requests, and drops one the work tree overtook", async () => {
      const corpus = await Corpus.load({ cwd: fixture.repo });
      const tracker = (await ChangeTracker.open(corpus, {
        env: fixture.env,
      }))!;
      const [first, second] = await Promise.all([
        tracker.review(true),
        tracker.review(true),
      ]);
      expect(second).toBe(first);

      tracker.invalidate();
      const overtaken = tracker.review(true);
      tracker.invalidate();
      const fresh = tracker.review(true);
      expect(await fresh).not.toBe(await overtaken);
      expect(await tracker.review(true)).toBe(await fresh);
    });

    // Every block of a document the branch added is new; the line above the text says so once.
    it("marks no blocks on a document the branch added", async () => {
      const { body } = await get(port, "/doc/docs/added.md");
      expect(articleOf(body)).toContain(
        '<span class="changes-banner-text">Added in this branch · +3 −0</span>',
      );
      expect(body).not.toContain("data-change");
    });
  },
);

// A branch whose change reaches past the files it touched. Committed: a heading renamed in a hub a
// reader links into, a line inserted in code a notes page links to below and above the insertion, a
// paragraph inserted above a broken link, and a style guide CLAUDE.md eagerly imports grown. Not
// committed: a new broken link in the guide and a larger context budget in the config.
const CONTEXT_CONFIG = (maxTokens: number) =>
  `${JSON.stringify(
    {
      include: ["**/*.md"],
      rules: [
        { rule: "REF-001" },
        { rule: "REF-002" },
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

const APP = `${Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;

async function contextBranch(): Promise<GitFixture> {
  const fixture = await makeRepo();
  await fixture.write("wastech-mdlint.config.json", CONTEXT_CONFIG(40));
  await fixture.write("CLAUDE.md", "# Rules\n\n@rules/style.md\n");
  await fixture.write("rules/style.md", "# Style\n\nShort.\n");
  await fixture.write("docs/hub.md", "# Hub\n\n## Setup\n\nText.\n");
  await fixture.write(
    "docs/reader.md",
    "# Reader\n\nSee [setup](hub.md#setup).\n",
  );
  await fixture.write(
    "docs/code.md",
    "# Code\n\nSee [start](../src/app.ts#L3-L4), [later](../src/app.ts#L10) and [top](../src/app.ts#L1).\n",
  );
  await fixture.write(
    "docs/guide.md",
    "# Guide\n\nSee [missing](nowhere.md).\n",
  );
  await fixture.write("src/app.ts", APP);
  fixture.commit("base");

  fixture.git("checkout", "-q", "-b", "feature");
  await fixture.write("docs/hub.md", "# Hub\n\n## Installation\n\nText.\n");
  await fixture.write(
    "src/app.ts",
    APP.replace("line 5\n", "line 5\ninserted\n"),
  );
  await fixture.write(
    "docs/guide.md",
    "# Guide\n\nA paragraph above.\n\nSee [missing](nowhere.md).\n",
  );
  await fixture.write(
    "rules/style.md",
    `# Style\n\n${"Write short sentences in the present tense. ".repeat(4)}\n`,
  );
  fixture.commit("feature work");

  await fixture.write(
    "docs/guide.md",
    "# Guide\n\nA paragraph above.\n\nSee [missing](nowhere.md).\n\nAnd [another](gone.md).\n",
  );
  await fixture.write("wastech-mdlint.config.json", CONTEXT_CONFIG(45));
  return fixture;
}

type Finding = { filePath: string; line: number; ruleId: string };

type ContextPayload = ChangesPayload & {
  config: (ChangesPayload["config"] & { findings: unknown }) | null;
  documents: (ChangedDocument & {
    context: {
      findings: { added: Finding[]; removed: Finding[] };
      size: {
        base: { tokens: number } | null;
        head: { tokens: number } | null;
      };
    } | null;
  })[];
  context: {
    findings: {
      added: { errors: number; warnings: number };
      removed: { errors: number; warnings: number };
    };
    eagerContext: {
      entrypoint: string;
      base?: number;
      head?: number;
      maxTokens: number;
    }[];
    affected: {
      findings: { path: string; added: Finding[] }[];
      codeLinks: {
        from: string;
        line: number;
        target: string;
        start: number;
        end: number;
      }[];
      linking: { path: string; targets: string[] }[];
    };
    notes: string[];
  } | null;
};

describe.skipIf(!hasGit)(
  "the context of a change (requires git on PATH)",
  () => {
    let fixture: GitFixture;
    let viewer: RunningViewer;
    let port: number;
    let api: ContextPayload;

    beforeAll(async () => {
      fixture = await contextBranch();
      viewer = await startViewer({
        cwd: fixture.repo,
        host: "127.0.0.1",
        port: 0,
        portExplicit: true,
        watch: false,
        gitEnv: fixture.env,
      });
      port = portOf(viewer);
      api = JSON.parse(
        (await get(port, "/api/changes")).body,
      ) as ContextPayload;
    }, 60_000);

    afterAll(async () => {
      await viewer?.close();
    });

    const document = (path: string) =>
      api.documents.find((entry) => entry.path === path);

    // The guide's old broken link moved down two lines under the new paragraph; mapped through the
    // diff it is the same finding, and only the uncommitted new link is new.
    it("follows a finding a change moved, and reports only what is new", () => {
      expect(
        document("docs/guide.md")?.context?.findings.added.map(
          (finding) => `${finding.ruleId} ${finding.line}`,
        ),
      ).toEqual(["REF-001 7"]);
      expect(document("docs/guide.md")?.context?.findings.removed).toEqual([]);
    });

    it("lists the unchanged documents the change reaches", () => {
      const affected = api.context!.affected;
      // CLAUDE.md did not change, but what it loads did: its budget finding names a new total. The
      // reader's link lost the heading it pointed at.
      expect(
        affected.findings.map(
          (entry) =>
            `${entry.path} ${entry.added.map((finding) => finding.ruleId).join(" ")}`,
        ),
      ).toEqual(["CLAUDE.md LLM-001", "docs/reader.md REF-002"]);
      // The insertion after line 5 moved line 10 and left lines 1 to 4 where they were.
      expect(affected.codeLinks).toEqual([
        {
          from: "docs/code.md",
          line: 3,
          target: "src/app.ts",
          start: 10,
          end: 10,
        },
      ]);
      expect(affected.linking).toContainEqual({
        path: "docs/reader.md",
        targets: ["docs/hub.md"],
      });
    });

    it("moves a document given a new error up, after every session's context", () => {
      expect(api.documents.map((entry) => entry.path)).toEqual([
        "rules/style.md",
        "docs/guide.md",
        "docs/hub.md",
      ]);
    });

    it("says what every session loads now against its budget", () => {
      const [eager] = api.context!.eagerContext;
      expect(eager).toMatchObject({ entrypoint: "CLAUDE.md", maxTokens: 45 });
      expect(eager!.head).toBeGreaterThan(eager!.base!);
    });

    // @boundary-guard host-parity
    // The page and `/api/changes` describe one context delta: the page's numbers are read back from
    // its words — the findings beside each row, every session's budget line, the affected documents
    // — and compared with the JSON, so a count worded on the page cannot drift from the data.
    it("shows on the page the same delta the API lists", async () => {
      const { body } = await get(port, "/changes");
      const list =
        /<nav class="changes-files"[\s\S]*?<\/nav>/.exec(body)?.[0] ?? "";
      const rows = [
        ...list.matchAll(
          /<a href="#[^"]*">([^<]+)<\/a>[\s\S]*?(?:<span class="change-findings"[^>]*>([^<]+)<\/span>)?<\/li>/g,
        ),
      ].map((match) => {
        const words = match[2] ?? "";
        const count = (pattern: RegExp) =>
          Number(pattern.exec(words)?.[1] ?? 0);
        return {
          path: match[1],
          errors: count(/\+(\d+) errors?/),
          warnings: count(/\+(\d+) warnings?/),
          removed: count(/−(\d+) findings?/),
        };
      });
      expect(rows).toEqual(
        api.documents.map((entry) => {
          const added = entry.context?.findings.added ?? [];
          const errors = added.filter(
            (finding) =>
              (finding as Finding & { severity: string }).severity === "error",
          ).length;
          return {
            path: entry.path,
            errors,
            warnings: added.length - errors,
            removed: entry.context?.findings.removed.length ?? 0,
          };
        }),
      );

      const eagerLines = [
        ...body.matchAll(
          /<p class="changes-eager[^"]*">([^ ]+) eager context (\d+) → (\d+) tokens \([^,]+, budget (\d+)\)<\/p>/g,
        ),
      ].map((match) => ({
        entrypoint: match[1],
        base: Number(match[2]),
        head: Number(match[3]),
        maxTokens: Number(match[4]),
      }));
      expect(eagerLines).toEqual(api.context!.eagerContext);

      const affected =
        /<section class="changes-affected"[\s\S]*?<\/section>/.exec(
          body,
        )?.[0] ?? "";
      const codeLinks = [
        ...affected.matchAll(
          /<a href="\/doc\/[^"]*">([^<]+)<\/a> line (\d+) → <a href="[^"]*">([^#<]+)#L(\d+)(?:-L(\d+))?<\/a>/g,
        ),
      ].map((match) => ({
        from: match[1],
        line: Number(match[2]),
        target: match[3],
        start: Number(match[4]),
        end: Number(match[5] ?? match[4]),
      }));
      expect(codeLinks).toEqual(api.context!.affected.codeLinks);
    });

    it("shows what the config change alone does on the config's card", async () => {
      const { body } = await get(port, "/changes");
      const card =
        /<section class="change-card" id="change\.wastech-mdlint\.config\.json">[\s\S]*?<\/section>/.exec(
          body,
        )?.[0];
      expect(card).toContain(
        "The config change alone, over the current documents: +1 warning, −1 finding",
      );
      expect(api.config?.findings).toMatchObject({
        added: [{ ruleId: "LLM-001", filePath: "CLAUDE.md" }],
        removed: [{ ruleId: "LLM-001", filePath: "CLAUDE.md" }],
      });
    });

    it("leaves uncommitted work out of the delta with commits only", async () => {
      const commits = JSON.parse(
        (await get(port, "/api/changes?worktree=0")).body,
      ) as ContextPayload;
      const guide = commits.documents.find(
        (entry) => entry.path === "docs/guide.md",
      );
      expect(guide?.context?.findings).toEqual({ added: [], removed: [] });
      // The budget the commits were linted with is the committed config's.
      expect(commits.context!.eagerContext[0]).toMatchObject({
        maxTokens: 40,
      });
      expect(commits.config).toBeNull();
    });

    it("marks the change on the graph when asked, and only then", async () => {
      type View = {
        nodes: { path: string; change?: string }[];
        edges: { from: string; to: string; change?: string }[];
      };
      const marked = JSON.parse(
        (await get(port, "/api/graph?changes=1")).body,
      ) as View;
      const changeOf = (path: string) =>
        marked.nodes.find((node) => node.path === path)?.change;
      expect(changeOf("docs/hub.md")).toBe("M");
      expect(changeOf("docs/reader.md")).toBe("affected");
      expect(changeOf("docs/code.md")).toBe("affected");
      // The broken anchor is no link any more, and is drawn as one the branch removed.
      expect(marked.edges).toContainEqual({
        from: "docs/reader.md",
        to: "docs/hub.md",
        change: "removed",
      });
      const plain = JSON.parse((await get(port, "/api/graph")).body) as View;
      expect(plain.nodes.some((node) => node.change !== undefined)).toBe(false);
      expect((await get(port, "/graph?changes=1")).body).toContain(
        '<input type="checkbox" name="changes" value="1" checked>',
      );
    });

    it("filters the dashboard to changed documents and counts their findings", async () => {
      const result = JSON.parse(
        (await get(port, "/api/dashboard?changed=1")).body,
      ) as {
        query: { changed?: boolean };
        rows: {
          path: string;
          change: { status?: string; findingsAdded: number } | null;
        }[];
      };
      expect(result.query.changed).toBe(true);
      expect(
        result.rows.map((row) => `${row.change?.status} ${row.path}`),
      ).toEqual(["M docs/guide.md", "M docs/hub.md", "M rules/style.md"]);
      expect(
        result.rows.find((row) => row.path === "docs/guide.md")?.change,
      ).toMatchObject({ findingsAdded: 1 });
      const csv = (await get(port, "/api/dashboard?format=csv&changed=1")).body;
      expect(csv.split("\r\n")[0]).toMatch(
        /,change,findingsAdded,findingsRemoved$/,
      );
      const page = (await get(port, "/dashboard")).body;
      expect(page).toContain(
        '<input type="checkbox" name="changed" value="1"> Changed in this branch',
      );
    });
  },
);

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
        // A filter that cannot apply says so rather than showing every document, or none.
        const dashboard = await get(port, "/api/dashboard?changed=1");
        expect(dashboard.status).toBe(400);
        expect(JSON.parse(dashboard.body)).toEqual({
          error:
            "There is no branch to compare: the Changed filter needs a git work tree and a base branch.",
        });
        const plain = JSON.parse((await get(port, "/api/dashboard")).body) as {
          rows: object[];
        };
        expect(plain.rows[0]).not.toHaveProperty("change");
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
