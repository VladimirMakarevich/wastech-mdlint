import { describe, expect, it } from "vitest";

import {
  type GitRepository,
  openGitRepository,
  parseBlamePorcelain,
} from "../src/git/git-repository.js";
import { hasGit, makeRepo } from "./support/git-fixture.js";

const TIMEOUT_MS = 60_000;

async function open(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<GitRepository> {
  const repository = await openGitRepository(cwd, { env });
  if (!repository.available) {
    throw new Error(repository.message);
  }
  return repository;
}

const A = "a".repeat(40);
const B = "b".repeat(40);
const ZERO = "0".repeat(40);

describe("parseBlamePorcelain", () => {
  it("reads each line's commit, its details given once, and lines not committed yet", () => {
    const text = [
      `${A} 1 1 2`,
      "author Ada",
      "committer-time 1700000000",
      "summary First words",
      "filename doc.md",
      "\t# Title",
      `${A} 2 2`,
      "\t",
      `${ZERO} 3 3 1`,
      "author Not Committed Yet",
      "committer-time 1800000000",
      "summary Version of doc.md from doc.md",
      "\tA new line",
      `${B} 3 4 1`,
      "author Bea",
      "committer-time 1750000000",
      "summary Second words",
      "previous 1111111111111111111111111111111111111111 doc.md",
      "filename doc.md",
      "\tThe end",
      "",
    ].join("\n");
    expect(parseBlamePorcelain(text)).toEqual([
      {
        commit: A,
        short: "aaaaaaa",
        date: "2023-11-14",
        author: "Ada",
        subject: "First words",
      },
      {
        commit: A,
        short: "aaaaaaa",
        date: "2023-11-14",
        author: "Ada",
        subject: "First words",
      },
      {},
      {
        commit: B,
        short: "bbbbbbb",
        date: "2025-06-15",
        author: "Bea",
        subject: "Second words",
      },
    ]);
  });
});

describe.skipIf(!hasGit)(
  "a file's history and blame (requires git on PATH)",
  () => {
    it(
      "lists the commits that touched a file across a rename, newest first, and blames the work tree",
      async () => {
        const fixture = await makeRepo();
        await fixture.write("docs/old.md", "# Title\n\nFirst.\n");
        fixture.commit("Add the page");
        fixture.git("mv", "docs/old.md", "docs/new.md");
        fixture.commit("Move the page");
        await fixture.write("docs/new.md", "# Title\n\nFirst.\n\nSecond.\n");
        fixture.commit("Extend the page");
        await fixture.write("docs/other.md", "# Other\n");
        fixture.commit("Unrelated");
        await fixture.write(
          "docs/new.md",
          "# Title\n\nFirst, edited.\n\nSecond.\n",
        );

        const repository = await open(fixture.repo, fixture.env);
        const history = await repository.fileHistory("docs/new.md", 10);
        expect(history.map((commit) => commit.subject)).toEqual([
          "Extend the page",
          "Move the page",
          "Add the page",
        ]);
        expect(history[0]).toMatchObject({
          author: "Fixture",
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          short: expect.stringMatching(/^[0-9a-f]{7,}$/),
        });
        expect(await repository.fileHistory("docs/new.md", 1)).toHaveLength(1);
        expect(await repository.fileHistory("docs/untracked.md", 5)).toEqual(
          [],
        );

        const blame = await repository.blame("docs/new.md");
        expect(blame).toHaveLength(5);
        expect(blame[0]?.subject).toBe("Add the page");
        expect(blame[2]).toEqual({});
        expect(blame[4]?.subject).toBe("Extend the page");
        expect(await repository.blame("docs/untracked.md")).toEqual([]);
      },
      TIMEOUT_MS,
    );
  },
);
