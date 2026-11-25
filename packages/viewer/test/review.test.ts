import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import {
  type GitFixture,
  hasGit,
  isolatedEnv,
  makeRepo,
} from "../../core/test/support/git-fixture.js";
import { parseCliArgs } from "../src/cli-args.js";
import { contentHash } from "../src/review-store.js";
import { startViewer, type RunningViewer } from "../src/server.js";

// The pages load the compiled page script, so the source it was compiled from must not be newer.
assertBuilt(
  fileURLToPath(new URL("../dist/client/review.js", import.meta.url)),
  fileURLToPath(new URL("../src/client/review.ts", import.meta.url)),
);

type Response = { status: number; body: string };

function send(
  port: number,
  rawPath: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path: rawPath,
        method: options.method ?? "GET",
        headers: options.headers,
      },
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
    outgoing.end(options.body);
  });
}

type Viewer = { viewer: RunningViewer; port: number; token: string };

// The token is taken from the Changes page, the page whose checkboxes send it.
async function start(
  cwd: string,
  stateDir: string,
  env?: NodeJS.ProcessEnv,
  tokenPage = "/changes",
): Promise<Viewer> {
  const viewer = await startViewer({
    cwd,
    host: "127.0.0.1",
    port: 0,
    portExplicit: true,
    watch: false,
    stateDir,
    ...(env === undefined ? {} : { gitEnv: env }),
  });
  const port = Number(new URL(viewer.url).port);
  const page = await send(port, tokenPage);
  const token =
    /<meta name="wastech-change-token" content="([0-9a-f]{64})">/.exec(
      page.body,
    )?.[1] ?? "";
  return { viewer, port, token };
}

// A mark request exactly as the page script sends one.
function post(
  target: Viewer,
  route: "mark" | "reset",
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return send(target.port, `/api/review/${route}`, {
    method: "POST",
    headers: {
      Origin: `http://127.0.0.1:${String(target.port)}`,
      "Content-Type": "application/json",
      "X-Wastech-Viewer-Token": target.token,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

type ChangesPayload = {
  documents: {
    path: string;
    status: string;
    review: { status: string; hash: string } | null;
  }[];
  review: {
    state: string;
    left?: number;
    total?: number;
    message?: string;
  } | null;
};

async function changes(target: Viewer, query = ""): Promise<ChangesPayload> {
  return JSON.parse(
    (await send(target.port, `/api/changes${query}`)).body,
  ) as ChangesPayload;
}

async function statuses(target: Viewer): Promise<Record<string, string>> {
  const payload = await changes(target);
  return Object.fromEntries(
    payload.documents.map((entry) => [
      entry.path,
      entry.review?.status ?? "none",
    ]),
  );
}

const GUIDE = "# Guide\n\nThe new text.\n";

const articleOf = (body: string) =>
  /<article class="markdown-body">[\s\S]*<\/article>/.exec(body)?.[0] ?? "";

// A feature branch with an edited, a deleted and an added document, all committed.
async function featureBranch(): Promise<GitFixture> {
  const fixture = await makeRepo();
  await fixture.write("README.md", "# Fixture\n\n[Guide](docs/guide.md)\n");
  await fixture.write("docs/guide.md", "# Guide\n\nThe old text.\n");
  await fixture.write("docs/gone.md", "# Gone\n\nGoing away.\n");
  await fixture.write("code.txt", "one\n");
  fixture.commit("base");
  fixture.git("checkout", "-q", "-b", "feature");
  await fixture.write("docs/guide.md", GUIDE);
  fixture.git("rm", "-q", "docs/gone.md");
  await fixture.write("docs/new.md", "# New\n\nAll new.\n");
  fixture.commit("feature work");
  return fixture;
}

const stateDirs: string[] = [];

async function stateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-review-"));
  stateDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(
    stateDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("parseCliArgs", () => {
  it("takes the folder for review marks", () => {
    expect(parseCliArgs(["--state-dir", "marks"])).toMatchObject({
      kind: "run",
      stateDir: "marks",
    });
    expect(parseCliArgs([])).not.toHaveProperty("stateDir");
  });
});

describe.skipIf(!hasGit)("review marks (requires git on PATH)", () => {
  let fixture: GitFixture;
  const running: Viewer[] = [];

  beforeAll(async () => {
    fixture = await featureBranch();
  }, 60_000);

  afterEach(async () => {
    await Promise.all(running.splice(0).map((target) => target.viewer.close()));
  });

  async function open(dir: string): Promise<Viewer> {
    const target = await start(fixture.repo, dir, fixture.env);
    running.push(target);
    return target;
  }

  async function markGuide(target: Viewer, reviewed = true): Promise<Response> {
    return post(target, "mark", {
      path: "docs/guide.md",
      hash: contentHash(GUIDE),
      reviewed,
      compare: "branch",
    });
  }

  it("shows a Viewed box on every card and above a changed document, and reading writes nothing", async () => {
    const dir = await stateDir();
    const target = await open(dir);
    expect(target.token).toMatch(/^[0-9a-f]{64}$/);
    const page = await send(target.port, "/changes");
    expect(
      page.body.match(/<label class="review-toggle" hidden/g),
    ).toHaveLength(3);
    expect(page.body).toContain(
      `<label class="review-toggle" hidden data-path="docs/guide.md" data-hash="${contentHash(GUIDE)}" data-compare="branch" title="Mark as viewed (v)">`,
    );
    expect(page.body).toContain("0 of 3 documents reviewed");
    expect(page.body).toContain("Only files left to review");
    const document = await send(target.port, "/doc/docs/guide.md");
    expect(document.body).toContain('<meta name="wastech-change-token"');
    expect(document.body).toMatch(
      /<div class="changes-banner">[\s\S]*class="review-toggle"/,
    );
    // An unchanged document has nothing to mark, so its page carries no token.
    expect((await send(target.port, "/doc/README.md")).body).not.toContain(
      "wastech-change-token",
    );
    for (const route of [
      "/api/changes",
      "/changes?since=review",
      "/doc/docs/guide.md?since=review",
      "/api/changes/diff?path=docs/guide.md&since=review",
      "/dashboard",
    ]) {
      await send(target.port, route);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it("counts every changed document left before anything is marked", async () => {
    const target = await open(await stateDir());
    const payload = await changes(target);
    expect(payload.review).toEqual({ state: "ready", left: 3, total: 3 });
    expect(
      payload.documents.find((entry) => entry.path === "docs/guide.md")?.review,
    ).toEqual({
      status: "unreviewed",
      hash: contentHash(GUIDE),
      sections: { reviewed: 0, total: 1 },
    });
  });

  // @boundary-guard host-parity
  // The page and its JSON must say the same about what the reader reviewed: the page's rows are
  // read back from their `data-review` attributes, the API's from its fields, so a status computed
  // one way for the page and another for the payload shows up as a difference here.
  it("marks the version the page showed, and the page and the API then agree", async () => {
    const target = await open(await stateDir());
    const answer = await markGuide(target);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({
      status: "saved",
      documents: [
        {
          path: "docs/guide.md",
          review: { status: "reviewed", hash: contentHash(GUIDE) },
          // The text before the first section: this document has no second-level heading.
          sections: [{ key: "", status: "reviewed" }],
        },
      ],
      left: 2,
      total: 3,
    });
    const api = await statuses(target);
    expect(api).toEqual({
      "docs/guide.md": "reviewed",
      "docs/gone.md": "unreviewed",
      "docs/new.md": "unreviewed",
    });
    const page = (await send(target.port, "/changes")).body;
    const rows = Object.fromEntries(
      [
        ...page.matchAll(
          /<li data-review="([a-z]+)">[\s\S]*?<a href="#change\.([^"]+)">/g,
        ),
      ].map((match) => [decodeURIComponent(match[2]!), match[1]!]),
    );
    expect(rows).toEqual(api);
    expect(page).toContain("1 of 3 documents reviewed");
    // A reviewed card folds to its header and the diff's summary line.
    expect(page).toMatch(
      /<section class="change-card" id="change\.docs%2Fguide\.md" data-review="reviewed">[\s\S]*?<span class="review-chip review-chip-reviewed">Reviewed<\/span>[\s\S]*?<details class="change-diff">/,
    );
    expect((await changes(target)).review).toEqual({
      state: "ready",
      left: 2,
      total: 3,
    });

    const undone = await markGuide(target, false);
    expect(JSON.parse(undone.body)).toMatchObject({ left: 3 });
    expect((await statuses(target))["docs/guide.md"]).toBe("unreviewed");
  });

  it("refuses to mark a version the page did not show, or a path the review does not hold", async () => {
    const dir = await stateDir();
    const target = await open(dir);
    const stale = await post(target, "mark", {
      path: "docs/guide.md",
      hash: contentHash("# Guide\n\nThe old text.\n"),
      reviewed: true,
      compare: "branch",
    });
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body)).toMatchObject({ status: "conflict" });
    const outside = await post(target, "mark", {
      path: "README.md",
      hash: contentHash("# Fixture\n\n[Guide](docs/guide.md)\n"),
      reviewed: true,
      compare: "branch",
    });
    expect(outside.status).toBe(409);
    // The hash is judged against the comparison the page showed: everything here is committed, so
    // the uncommitted review holds no such document to mark.
    const notUncommitted = await post(target, "mark", {
      path: "docs/guide.md",
      hash: contentHash(GUIDE),
      reviewed: true,
      compare: "uncommitted",
    });
    expect(notUncommitted.status).toBe(409);
    const shapeless = await post(target, "mark", { path: "docs/guide.md" });
    expect(shapeless.status).toBe(400);
    // The boolean that named the comparison before there were three is refused, not guessed at.
    for (const stale of [
      { compare: true },
      { compare: "worktree" },
      { worktree: true },
    ]) {
      const refused = await post(target, "mark", {
        path: "docs/guide.md",
        hash: contentHash(GUIDE),
        reviewed: true,
        ...stale,
      });
      expect(refused.status, JSON.stringify(stale)).toBe(400);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  // A mark records the text the page showed, not the comparison it was shown in: marked while
  // reading only the uncommitted edits, the same text counts as reviewed for the whole branch.
  it("marks a document from the uncommitted comparison, and the branch's review sees it", async () => {
    const own = await makeRepo();
    await own.write("docs/guide.md", "# Guide\n\nThe old text.\n");
    own.commit("base");
    own.git("checkout", "-q", "-b", "feature");
    await own.write("docs/added.md", "# Added\n\nCommitted on the branch.\n");
    own.commit("feature work");
    await own.write("docs/guide.md", GUIDE);

    const target = await start(own.repo, await stateDir(), own.env);
    running.push(target);
    const page = await send(target.port, "/changes?compare=uncommitted");
    expect(page.body).toContain(
      `<label class="review-toggle" hidden data-path="docs/guide.md" data-hash="${contentHash(GUIDE)}" data-compare="uncommitted" title="Mark as viewed (v)">`,
    );
    expect(page.body).not.toContain('data-path="docs/added.md"');
    expect(page.body).toContain("0 of 1 document reviewed");

    const marked = await post(target, "mark", {
      path: "docs/guide.md",
      hash: contentHash(GUIDE),
      reviewed: true,
      compare: "uncommitted",
    });
    expect(marked.status).toBe(200);
    expect(JSON.parse(marked.body)).toMatchObject({ left: 0, total: 1 });
    expect(await statuses(target)).toEqual({
      "docs/added.md": "unreviewed",
      "docs/guide.md": "reviewed",
    });
  });

  // The uncommitted comparison starts after the commit that renamed a document, so it lists the
  // document under its new name alone. Its marks under the old name must still count there, or one
  // document reads as not reviewed in one comparison and as changed since review in the other — and
  // a reset from there must forget them too, as the branch's own reset does.
  it("finds and resets a renamed document's marks from the uncommitted comparison", async () => {
    const own = await makeRepo();
    const lines = (edits: Record<number, string>) =>
      `${[
        "# Alpha",
        "",
        ...Array.from(
          { length: 12 },
          (_, index) => edits[index] ?? `Line ${String(index)} stays.`,
        ),
      ].join("\n")}\n`;
    await own.write("docs/a.md", lines({}));
    own.commit("base");
    own.git("checkout", "-q", "-b", "feature");
    const reviewedText = lines({ 0: "Line 0 was edited." });
    await own.write("docs/a.md", reviewedText);
    own.commit("edit a");

    const dir = await stateDir();
    const before = await start(own.repo, dir, own.env);
    try {
      const marked = await post(before, "mark", {
        path: "docs/a.md",
        hash: contentHash(reviewedText),
        reviewed: true,
        compare: "branch",
      });
      expect(marked.status).toBe(200);
    } finally {
      await before.viewer.close();
    }

    own.git("mv", "docs/a.md", "docs/b.md");
    await own.write("docs/b.md", lines({ 0: "Line 0 was edited.", 1: "1!" }));
    own.commit("rename a to b");
    const onDisk = lines({ 0: "Line 0 was edited.", 1: "1!", 2: "2!" });
    await own.write("docs/b.md", onDisk);

    const target = await start(own.repo, dir, own.env);
    running.push(target);
    const branch = await changes(target);
    expect(branch.documents).toMatchObject([
      { path: "docs/b.md", status: "R", review: { status: "changed" } },
    ]);
    const uncommitted = await changes(target, "?compare=uncommitted");
    expect(uncommitted.documents).toMatchObject([
      { path: "docs/b.md", status: "M", review: { status: "changed" } },
    ]);

    const reset = await post(target, "reset", {
      compare: "uncommitted",
      documents: [{ path: "docs/b.md", hash: contentHash(onDisk) }],
    });
    expect(reset.status).toBe(200);
    expect(await statuses(target)).toEqual({ "docs/b.md": "unreviewed" });
  });

  it("refuses a mark from another origin, without the page's token, or not sent as JSON", async () => {
    const dir = await stateDir();
    const target = await open(dir);
    const body = {
      path: "docs/guide.md",
      hash: contentHash(GUIDE),
      reviewed: true,
      compare: "branch",
    };
    const refusals = await Promise.all([
      post(target, "mark", body, { Origin: "http://evil.example" }),
      post(target, "mark", body, { "X-Wastech-Viewer-Token": "" }),
      post(target, "mark", body, { "Content-Type": "text/plain" }),
      post(target, "mark", body, { "Sec-Fetch-Site": "cross-site" }),
    ]);
    expect(refusals.map((response) => response.status)).toEqual([
      403, 403, 415, 403,
    ]);
    expect((await send(target.port, "/api/review/mark")).status).toBe(405);
    expect(await readdir(dir)).toEqual([]);
  });

  it("keeps marks across a restart, and shows what changed since the review", async () => {
    const dir = await stateDir();
    const first = await open(dir);
    expect((await markGuide(first)).status).toBe(200);
    await first.viewer.close();
    running.splice(running.indexOf(first), 1);

    await fixture.write("docs/guide.md", "# Guide\n\nThe newer text.\n");
    try {
      const second = await open(dir);
      expect((await statuses(second))["docs/guide.md"]).toBe("changed");
      const diff = JSON.parse(
        (
          await send(
            second.port,
            "/api/changes/diff?path=docs/guide.md&since=review",
          )
        ).body,
      ) as { diff: { hunks: { lines: { kind: string; text: string }[] }[] } };
      expect(diff.diff.hunks.flatMap((hunk) => hunk.lines)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "removed", text: "The new text." }),
          expect.objectContaining({ kind: "added", text: "The newer text." }),
        ]),
      );
      const page = (await send(second.port, "/doc/docs/guide.md?since=review"))
        .body;
      expect(page).toContain("Changed since your review · +1 −1");
      expect(page).toContain(
        '<span class="review-chip review-chip-changed">Changed since review</span>',
      );
      expect(page).toMatch(/data-change="changed"[^>]*>The newer text\./);
      const changesPage = (await send(second.port, "/changes?since=review"))
        .body;
      expect(changesPage).toContain("Changes since your last review.");
      expect(changesPage).toContain(
        "Not reviewed yet, so this compares with the base branch.",
      );

      // Reviewed again as it is now, there is nothing since the review to show.
      const marked = await post(second, "mark", {
        path: "docs/guide.md",
        hash: contentHash("# Guide\n\nThe newer text.\n"),
        reviewed: true,
        compare: "branch",
      });
      expect(marked.status).toBe(200);
      const unchanged = articleOf(
        (await send(second.port, "/doc/docs/guide.md?since=review")).body,
      );
      expect(unchanged).toContain("Unchanged since your review");
      expect(unchanged).not.toContain("data-change=");
    } finally {
      await fixture.write("docs/guide.md", GUIDE);
    }
  }, 30_000);

  it("keeps a mark when another branch holds the same text, and when the document moves", async () => {
    const dir = await stateDir();
    const first = await open(dir);
    expect((await markGuide(first)).status).toBe(200);
    expect(
      (
        await post(first, "mark", {
          path: "docs/new.md",
          hash: contentHash("# New\n\nAll new.\n"),
          reviewed: true,
          compare: "branch",
        })
      ).status,
    ).toBe(200);

    fixture.git("checkout", "-q", "-b", "elsewhere");
    await fixture.write("code.txt", "two\n");
    fixture.commit("unrelated work");
    try {
      // The branch moved under the running viewer; the next request notices and reviews it again.
      expect((await statuses(first))["docs/guide.md"]).toBe("reviewed");

      fixture.git("mv", "docs/new.md", "docs/fresh.md");
      fixture.commit("rename");
      const second = await open(dir);
      expect(await statuses(second)).toMatchObject({
        "docs/guide.md": "reviewed",
        "docs/fresh.md": "reviewed",
      });
    } finally {
      fixture.git("checkout", "-q", "feature");
      fixture.git("branch", "-q", "-D", "elsewhere");
    }
  }, 30_000);

  it("starts the review over for the documents a page listed", async () => {
    const target = await open(await stateDir());
    expect((await markGuide(target)).status).toBe(200);
    const payload = await changes(target);
    const reset = await post(target, "reset", {
      compare: "branch",
      documents: payload.documents.map((entry) => ({
        path: entry.path,
        hash: entry.review?.hash,
      })),
    });
    expect(reset.status).toBe(200);
    expect(Object.values(await statuses(target))).toEqual([
      "unreviewed",
      "unreviewed",
      "unreviewed",
    ]);
  });

  // @boundary-guard write-failure
  //
  // A state directory that cannot hold the marks — here a regular file in its place, which refuses
  // the folder the first mark creates on every platform. The request must say the mark failed, not
  // that it was saved; the file in the way must be untouched with nothing left beside it; and the
  // page, which draws a mark only from what the server stored, must not show the document reviewed.
  it("reports a mark it could not store, and shows nothing as marked", async () => {
    const parent = await stateDir();
    const blocked = path.join(parent, "state");
    await writeFile(blocked, "not a folder\n");
    const target = await open(blocked);
    const answer = await markGuide(target);
    expect(answer.status).toBe(500);
    expect(JSON.parse(answer.body)).toEqual({
      status: "failed",
      error: expect.stringMatching(
        /^The review mark could not be saved \([A-Z]+\); nothing was changed\.$/,
      ),
    });
    expect(await readdir(parent)).toEqual(["state"]);
    expect(await readFile(blocked, "utf8")).toBe("not a folder\n");
    expect((await statuses(target))["docs/guide.md"]).toBe("unreviewed");
    expect((await send(target.port, "/changes")).body).not.toContain(
      'data-review="reviewed"',
    );
  });
});

describe("review marks outside a git work tree", () => {
  it("draws no Viewed box and refuses a mark", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-plain-"));
    stateDirs.push(dir);
    await writeFile(path.join(dir, "README.md"), "# Plain\n");
    await writeFile(path.join(dir, "wastech-mdlint.config.json"), "{}\n");
    const state = await stateDir();
    // The config page is the only one that carries a token here. Git is kept from finding a
    // repository above the temporary folder, as a dotfiles repository at the home directory would be.
    const target = await start(dir, state, isolatedEnv(dir), "/config");
    try {
      expect((await send(target.port, "/doc/README.md")).body).not.toContain(
        "review-toggle",
      );
      const answer = await post(target, "mark", {
        path: "README.md",
        hash: contentHash("# Plain\n"),
        reviewed: true,
        compare: "branch",
      });
      expect(answer.status).toBe(403);
      expect(JSON.parse(answer.body)).toMatchObject({ status: "refused" });
      expect(await readdir(state)).toEqual([]);
    } finally {
      await target.viewer.close();
    }
  });
});

describe.skipIf(!hasGit)("section marks (requires git on PATH)", () => {
  // A document whose sections the branch edits: marked one section at a time from the outline, it
  // counts as reviewed once every section is, without ever being marked as a whole.
  it("marks sections from the outline and counts the document reviewed once every section is", async () => {
    const fixture = await makeRepo();
    await fixture.write("README.md", "# Fixture\n");
    await fixture.write(
      "docs/guide.md",
      "# Guide\n\nIntro.\n\n## Install\n\nOld install.\n\n## Use\n\nUse it.\n",
    );
    fixture.commit("base");
    fixture.git("checkout", "-q", "-b", "feature");
    await fixture.write(
      "docs/guide.md",
      "# Guide\n\nIntro, reworded.\n\n## Install\n\nNew install.\n\n## Use\n\nUse it well.\n",
    );
    const target = await start(fixture.repo, await stateDir(), fixture.env);
    try {
      const page = (await send(target.port, "/doc/docs/guide.md")).body;
      const buttons = [
        ...page.matchAll(
          /<button class="section-mark" type="button" hidden aria-pressed="false" aria-label="[^"]*" title="Not viewed yet" data-path="docs\/guide\.md" data-section="([a-z]*)" data-hash="([0-9a-f]{64})">/g,
        ),
      ].map((match) => ({ section: match[1]!, hash: match[2]! }));
      // The text before the first section has no heading, so the outline gives it an entry of its
      // own, first, marked as changed since the branch reworded it.
      expect(buttons.map((button) => button.section)).toEqual([
        "",
        "install",
        "use",
      ]);
      expect(page).toMatch(
        /<li class="depth-2" data-review="unreviewed"><a href="#viewer\.content">Introduction<span class="outline-change"[^>]*><\/span><\/a><button class="section-mark"[^>]*data-section=""/,
      );
      const [introButton, ...headed] = buttons;

      const sectionPost = (body: unknown) =>
        send(target.port, "/api/review/section", {
          method: "POST",
          headers: {
            Origin: `http://127.0.0.1:${String(target.port)}`,
            "Content-Type": "application/json",
            "X-Wastech-Viewer-Token": target.token,
          },
          body: JSON.stringify(body),
        });
      const stale = await sectionPost({
        path: "docs/guide.md",
        section: "use",
        hash: contentHash("## Use\n\nUse it."),
        reviewed: true,
      });
      expect(stale.status).toBe(409);

      for (const button of headed) {
        const answer = await sectionPost({
          path: "docs/guide.md",
          section: button.section,
          hash: button.hash,
          reviewed: true,
        });
        expect(JSON.parse(answer.body)).toMatchObject({
          status: "saved",
          section: { key: button.section, status: "reviewed" },
        });
      }
      // The text before the first section is a section too, and is not marked yet.
      expect((await statuses(target))["docs/guide.md"]).toBe("changed");
      // The card says how far the section review has got, and the JSON says the same in numbers.
      const progressOf = async () =>
        /<section class="change-card" id="change\.docs%2Fguide\.md"[\s\S]*?<\/header>/
          .exec((await send(target.port, "/changes")).body)?.[0]
          .match(/<span class="review-sections"[^>]*>(\d+) of (\d+) sections</)
          ?.slice(1)
          .map(Number);
      expect(await progressOf()).toEqual([2, 3]);
      expect(
        (await changes(target)).documents.find(
          (entry) => entry.path === "docs/guide.md",
        )?.review,
      ).toMatchObject({ sections: { reviewed: 2, total: 3 } });
      expect(introButton!.hash).toBe(
        contentHash("# Guide\n\nIntro, reworded."),
      );
      const intro = await sectionPost({
        path: "docs/guide.md",
        section: "",
        hash: introButton!.hash,
        reviewed: true,
      });
      expect(JSON.parse(intro.body)).toMatchObject({
        documents: [{ path: "docs/guide.md", review: { status: "reviewed" } }],
      });
      expect((await statuses(target))["docs/guide.md"]).toBe("reviewed");
      // Every section viewed: the status says it, so the count is gone.
      expect(await progressOf()).toBeUndefined();
      expect((await send(target.port, "/doc/docs/guide.md")).body).toMatch(
        /<li class="depth-2" data-review="reviewed">[\s\S]*?aria-pressed="true"/,
      );
    } finally {
      await target.viewer.close();
    }
  }, 30_000);
});
