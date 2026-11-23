import type { ScopeTester } from "../config/scope-tester.js";
import { compareStrings } from "../deterministic-sort.js";
import { isMarkdownFile } from "../discovery/markdown-extensions.js";
import type {
  GitBase,
  GitChange,
  GitRepository,
  GitUnavailable,
} from "../git/git-repository.js";

// Which of a branch's changes a review of the corpus shows. Git reports every changed path; a
// reviewer of documents needs them sorted into the documents the linter checks, the config that
// decides what those are, Markdown the scope leaves out — counted, so a narrowed scope never reads
// as "no changes" — and everything else, which a document may still link to.

/** What a change set is judged against: the corpus as the host loaded it from the work tree. */
export type CorpusMembership = {
  /** The documents the corpus holds, by repository-relative path. */
  documents: { has(relPath: string): boolean };
  /**
   * The corpus scope, for a document that no longer exists on disk: a deleted or renamed-away path
   * counts as a document when the current scope would hold it. That is the current config's view of
   * the base, not the base config's.
   */
  scope: ScopeTester;
  /** The config file's repository-relative path, when the corpus was loaded from one. */
  configPath?: string;
};

export type ClassifiedChanges = {
  /** Changes to corpus documents, sorted by path. */
  documents: GitChange[];
  /** Whether the config file itself changed, which changes what the corpus is. */
  configChanged: boolean;
  /** Changed Markdown files the corpus does not hold, sorted by path. */
  outsideCorpus: GitChange[];
  /** Every other changed file, sorted by path. */
  otherFiles: GitChange[];
};

export async function classifyChanges(
  changes: readonly GitChange[],
  corpus: CorpusMembership,
): Promise<ClassifiedChanges> {
  const result: ClassifiedChanges = {
    documents: [],
    configChanged: false,
    outsideCorpus: [],
    otherFiles: [],
  };
  const inCorpus = (relPath: string) => corpus.documents.has(relPath);
  const wouldBeInCorpus = async (relPath: string) =>
    corpus.scope.includes(relPath) &&
    !(await corpus.scope.excludes(relPath, false));
  const elsewhere = (change: GitChange) => {
    (isMarkdownFile(change.path)
      ? result.outsideCorpus
      : result.otherFiles
    ).push(change);
  };

  for (const change of changes) {
    if (
      corpus.configPath !== undefined &&
      (change.path === corpus.configPath ||
        change.oldPath === corpus.configPath)
    ) {
      result.configChanged = true;
      continue;
    }
    if (change.status === "A" || change.status === "M") {
      if (inCorpus(change.path)) {
        result.documents.push(change);
      } else {
        elsewhere(change);
      }
      continue;
    }
    if (change.status === "D") {
      if (await wouldBeInCorpus(change.path)) {
        result.documents.push(change);
      } else {
        elsewhere(change);
      }
      continue;
    }

    // A rename that crosses the scope's edge is, from the corpus's side, an addition or a deletion,
    // and the half outside it is reported where an outside change is.
    const oldPath = change.oldPath ?? change.path;
    const newIn = inCorpus(change.path);
    const oldIn = await wouldBeInCorpus(oldPath);
    if (newIn && oldIn) {
      result.documents.push(change);
    } else if (newIn) {
      result.documents.push({ status: "A", path: change.path });
      elsewhere({ status: "D", path: oldPath });
    } else if (oldIn) {
      result.documents.push({ status: "D", path: oldPath });
      elsewhere({ status: "A", path: change.path });
    } else {
      elsewhere(change);
    }
  }

  const byPath = (left: GitChange, right: GitChange) =>
    compareStrings(left.path, right.path);
  result.documents.sort(byPath);
  result.outsideCorpus.sort(byPath);
  result.otherFiles.sort(byPath);
  return result;
}

/**
 * A branch's changes against its base, sorted for a review of the corpus. `head` and `mergeBase`
 * together say when it is stale: a commit, a checkout or a fetch moves one of them.
 */
export type ChangeSet = ClassifiedChanges & {
  base: GitBase;
  mergeBase: string;
  head: string;
  /** Whether uncommitted and untracked work is included, or only commits. */
  worktree: boolean;
};

/**
 * Resolve the base, find where the branch left it, list what changed since, and classify it
 * against the corpus — the one sequence every host showing a review runs, so none of them can pick
 * a different base or a different comparison.
 */
export async function collectChangeSet(
  repository: GitRepository,
  params: {
    /** A branch, tag or commit to compare with; the detected base branch when omitted. */
    base?: string;
    worktree: boolean;
    corpus: CorpusMembership;
  },
): Promise<ChangeSet | GitUnavailable> {
  const base = await repository.resolveBase(params.base);
  if ("available" in base) {
    return base;
  }
  const mergeBase = await repository.mergeBase(base);
  if (typeof mergeBase !== "string") {
    return mergeBase;
  }
  // A merge-base exists only when HEAD has a commit, so this is defined here.
  const head = (await repository.headCommit()) ?? mergeBase;
  const changes = await repository.changedPaths(mergeBase, {
    worktree: params.worktree,
  });
  return {
    base,
    mergeBase,
    head,
    worktree: params.worktree,
    ...(await classifyChanges(changes, params.corpus)),
  };
}
