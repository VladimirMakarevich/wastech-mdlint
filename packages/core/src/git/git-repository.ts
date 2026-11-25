import { realpath } from "node:fs/promises";
import path from "node:path";

import { compareStrings } from "../deterministic-sort.js";
import {
  GitCommandError,
  gitEnvironment,
  type GitInvocation,
  GitNotFoundError,
  runGit,
} from "./git-command.js";

// Read-only access to the git repository a host was pointed at: where its work tree starts, which
// branch a change is compared with, what changed, and what a file's text was at a commit. Every
// path in and out is relative to the host's root directory, POSIX-separated — the corpus's own
// coordinates — and the translation to git's top-level-relative paths happens in this file only.

// `GIT_CONFIG_COUNT`, which carries the settings that keep repository config from starting
// programs, arrived in 2.31; `rev-parse --end-of-options` in 2.30.
export const MINIMUM_GIT_VERSION = [2, 31] as const;

/**
 * Why a review of changes cannot be shown. Each is an expected state of a machine or a repository
 * rather than a fault, so it is returned with a message and a hint instead of thrown.
 */
export type GitUnavailableReason =
  | "no-git-binary"
  | "git-too-old"
  | "not-a-repository"
  | "dubious-ownership"
  | "invalid-ref"
  | "base-not-found"
  | "shallow-history";

export type GitUnavailable = {
  available: false;
  reason: GitUnavailableReason;
  message: string;
  hint: string;
};

/** The branch or commit a change is compared with, and the commit it names. */
export type GitBase = {
  ref: string;
  commit: string;
  /**
   * The full name `commit` was resolved from, when it differs from `ref`: an auto-detected base is
   * shown by its short name (`main`, `origin/main`) but found as `refs/heads/main` or
   * `refs/remotes/origin/main`. Resolving the short name again would pick a tag named `main`, or a
   * local branch named `origin/main`, over the ref the base came from.
   */
  fullRef?: string;
};

/**
 * One changed path. `R` keeps the old path; a copy, a type change and an unmerged path read as an
 * addition, a modification and a modification, which is all a reader of documents needs to know.
 */
export type GitChange = {
  status: "A" | "M" | "D" | "R";
  path: string;
  oldPath?: string;
};

/**
 * A commit as a reader sees it in a file's history. `date` is the commit's own date in UTC as
 * `YYYY-MM-DD`: fixed for a given repository state, unlike a "3 days ago" that changes with the
 * clock. `author` is a person's name, which a host shows only where absolute paths may be shown.
 */
export type FileCommit = {
  commit: string;
  short: string;
  date: string;
  author: string;
  subject: string;
};

/** The commit that last touched a line, or no commit for a line not committed yet. */
export type BlameLine = Partial<FileCommit>;

export type OpenGitRepositoryOptions = {
  /** The environment to derive git's from; the process's own when omitted. */
  env?: NodeJS.ProcessEnv;
};

function unavailable(
  reason: GitUnavailableReason,
  message: string,
  hint: string,
): GitUnavailable {
  return { available: false, reason, message, hint };
}

// A full object name, SHA-1 or SHA-256. Methods that take a commit take one of these, as returned
// by `resolveBase` and `mergeBase`, so nothing a user typed is ever passed to git positionally.
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function requireObjectName(value: string): string {
  if (!OBJECT_NAME.test(value)) {
    throw new TypeError(`Expected a full commit id, got "${value}"`);
  }
  return value;
}

/**
 * Open the repository whose work tree contains `rootDir`, or say why there is none to open.
 *
 * Throws only for a failure no expected state explains (`GitCommandError`), such as a corrupt
 * repository.
 */
export async function openGitRepository(
  rootDir: string,
  options: OpenGitRepositoryOptions = {},
): Promise<GitRepository | GitUnavailable> {
  const inherited = options.env ?? process.env;
  // Resolved first, so a directory that does not exist fails here as itself rather than as the
  // `ENOENT` a child started in it reports — which reads exactly like a missing `git`.
  const probe: GitInvocation = {
    cwd: await realpath(rootDir),
    env: gitEnvironment(inherited),
  };

  const versionProblem = await checkGitVersion(probe);
  if (versionProblem !== undefined) {
    return versionProblem;
  }

  const located = await locateRepository(probe);
  if ("available" in located) {
    return located;
  }

  return new GitRepository(
    { cwd: located.topLevel, inherited },
    located.prefix,
    located.commonDirReal,
    located.gitDirReal,
  );
}

// Why git cannot be used at all — no binary, or one older than `MINIMUM_GIT_VERSION` — or
// undefined when the installed git will do.
async function checkGitVersion(
  probe: GitInvocation,
): Promise<GitUnavailable | undefined> {
  const versionOutput = await runGit(probe, ["version"]).catch(
    (error: unknown) => {
      if (error instanceof GitNotFoundError) {
        return undefined;
      }
      throw error;
    },
  );
  if (versionOutput === undefined) {
    return unavailable(
      "no-git-binary",
      "git was not found on PATH.",
      "Install git, or put the directory that holds it on PATH.",
    );
  }
  const version = /(\d+)\.(\d+)/.exec(versionOutput.stdout.toString("utf8"));
  const [major, minor] = [Number(version?.[1]), Number(version?.[2])];
  const [minMajor, minMinor] = MINIMUM_GIT_VERSION;
  if (
    version === null ||
    major < minMajor ||
    (major === minMajor && minor < minMinor)
  ) {
    const found =
      version === null ? "an unrecognized git" : `git ${version[0]}`;
    return unavailable(
      "git-too-old",
      `Found ${found}; reviewing changes needs git ${String(minMajor)}.${String(minMinor)} or later.`,
      "Update git.",
    );
  }
  return undefined;
}

// Where the repository around the probe directory lives: its work tree's top level, the probe's
// prefix inside it (without a trailing slash; `""` at the top), and the realpaths of its common and
// per-worktree git directories.
type LocatedRepository = {
  topLevel: string;
  prefix: string;
  commonDirReal: string;
  gitDirReal: string;
};

async function locateRepository(
  probe: GitInvocation,
): Promise<LocatedRepository | GitUnavailable> {
  const located = await runGit(probe, [
    "rev-parse",
    "--show-toplevel",
    "--show-prefix",
    "--git-common-dir",
    "--absolute-git-dir",
  ]);
  if (located.exitCode !== 0) {
    return unlocatedRepository(located.exitCode, located.stderr);
  }

  // Four lines in the order asked for; the prefix line is empty at the top level and otherwise
  // ends in `/`.
  const [topLevel = "", prefixLine = "", commonDir = "", gitDir = ""] =
    located.stdout.toString("utf8").split("\n");
  return {
    topLevel,
    prefix: prefixLine.replace(/\/$/, ""),
    // Relative to the directory git ran in when it is not absolute. The realpath, so two spellings
    // of one clone (a symlink, an 8.3 short name on Windows) are one identity.
    commonDirReal: await realpath(path.resolve(probe.cwd, commonDir)),
    gitDirReal: await realpath(gitDir),
  };
}

// The expected reasons `rev-parse` finds no repository; any other failure is thrown.
function unlocatedRepository(exitCode: number, stderr: string): GitUnavailable {
  // Matched on git's text, which `LC_ALL=C` keeps untranslated. Ownership is checked before
  // anything else is read, so a repository another user owns never gets as far as its config.
  if (stderr.includes("dubious ownership")) {
    return unavailable(
      "dubious-ownership",
      "git refuses to read this repository because another user owns it.",
      "If you trust it, add it to git's safe.directory list: git config --global --add safe.directory <path>.",
    );
  }
  if (
    stderr.includes("not a git repository") ||
    stderr.includes("must be run in a work tree")
  ) {
    return unavailable(
      "not-a-repository",
      "The directory is not inside a git work tree.",
      "Changes can be reviewed only in a git repository.",
    );
  }
  throw new GitCommandError("rev-parse", exitCode, stderr);
}

// Filter drivers are named in config and attached to paths by `.gitattributes`; git runs a
// driver's `clean` command on every work-tree file whose stat changed when it compares the work
// tree. They are emptied — an empty command is no filter — for every driver any config defines,
// the user's own included: a legitimate driver such as git-lfs is not told apart from a planted
// one, so a Markdown file kept in LFS compares as its pointer text.
//
// Protocols are the same shape of problem: the fixed settings every call carries refuse the
// transports git knows by name, but a config can allow one of its own — `protocol.<name>.allow`,
// for a remote helper reached through a `<name>::` URL — and a per-protocol key outranks the generic
// `protocol.allow`. So every protocol any config names is refused by name too.
//
// Listing them runs nothing: `git config` only reads files. Exported for tests.
export async function repositoryConfigOverrides(
  atTopLevel: GitInvocation,
): Promise<(readonly [string, string])[]> {
  const listed = await runGit(atTopLevel, [
    "config",
    "-z",
    "--get-regexp",
    "^(filter|protocol)\\.",
  ]);
  const driverNames = new Set<string>();
  const protocolNames = new Set<string>();
  // Exit 1 is "no such key": no filter drivers and no protocol settings at all.
  if (listed.exitCode === 0) {
    for (const entry of listed.stdout.toString("utf8").split("\0")) {
      // `<section>.<name>.<variable>\n<value>`; a name may itself contain dots, so it is
      // everything between the first and the last dot of the key.
      const key = entry.split("\n", 1)[0] ?? "";
      const firstDot = key.indexOf(".");
      const lastDot = key.lastIndexOf(".");
      if (lastDot <= firstDot + 1) {
        continue;
      }
      const name = key.slice(firstDot + 1, lastDot);
      if (key.startsWith("filter.")) {
        driverNames.add(name);
      } else if (key.startsWith("protocol.")) {
        protocolNames.add(name);
      }
    }
  }
  return [
    ...[...driverNames].sort(compareStrings).flatMap((name) => [
      [`filter.${name}.clean`, ""] as const,
      [`filter.${name}.smudge`, ""] as const,
      [`filter.${name}.process`, ""] as const,
      // A required driver with no command is an error rather than a skipped filter.
      [`filter.${name}.required`, "false"] as const,
    ]),
    ...[...protocolNames]
      .sort(compareStrings)
      .map((name) => [`protocol.${name}.allow`, "never"] as const),
  ];
}

// Diff flags no review call goes without: an external diff program and a textconv driver are both
// named by repository config and would run, and a submodule is not part of any corpus.
const SAFE_DIFF_FLAGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--ignore-submodules",
];

export class GitRepository {
  readonly available = true;

  constructor(
    // Where every command runs — the work tree's top level — and the caller's environment as given,
    // kept so each command's environment is built afresh around the overrides that call's config
    // scan found.
    private readonly launch: { cwd: string; inherited: NodeJS.ProcessEnv },
    // The host root's path from the work tree's top level, without a trailing slash; `""` at the
    // top. Private, so every path crosses between the two coordinate systems inside this class.
    private readonly prefix: string,
    /**
     * The realpath of the repository's common git directory, shared by every worktree of one clone:
     * the identity under which anything remembered about this repository is kept. Absolute, so it
     * is never shown to a reader.
     */
    readonly commonDir: string,
    /**
     * The realpath of this work tree's own git directory: the common one for the main work tree, a
     * folder under it for each added worktree. Its `HEAD` is this work tree's alone, while branches
     * and remote refs live in `commonDir` — together the two say where a host watches for a commit,
     * a checkout or a fetch. Absolute, so it is never shown to a reader.
     */
    readonly gitDir: string,
  ) {}

  /**
   * A path relative to the host root, restated from the work tree's top level. For what a host keeps
   * about a clone beside `commonDir`: two hosts started in different folders of one clone name the
   * same file differently among themselves, but the same way from the top level.
   */
  topLevelPath(relPath: string): string {
    return this.toTopLevel(relPath);
  }

  /** The commit `HEAD` names, or `undefined` before the first commit. */
  async headCommit(): Promise<string | undefined> {
    return this.resolveCommit("HEAD");
  }

  /**
   * The commits `HEAD` and the base (`base.fullRef`, else `base.ref`) name now, as one string —
   * `undefined` when either names none. One `rev-parse` after the config scan every command gets,
   * so a long-lived host can ask on every request whether a commit, a checkout or a fetch has made
   * what it computed from the two stale.
   */
  async revisionKey(base: GitBase): Promise<string | undefined> {
    // Refused here rather than with `--end-of-options`: outside `--verify` mode `rev-parse` echoes
    // that marker back as one more line of output instead of consuming it. Both arguments then end in
    // `^{commit}`, and neither can start with `-`.
    // The name the base was resolved from, so the key compares the same ref `resolveBase` found
    // rather than whatever its short name resolves to.
    const ref = base.fullRef ?? base.ref;
    if (ref.length === 0 || ref.startsWith("-")) {
      return undefined;
    }
    const output = await this.run([
      "rev-parse",
      "HEAD^{commit}",
      `${ref}^{commit}`,
    ]);
    const commits = output.stdout.toString("utf8").trim().split("\n");
    return output.exitCode === 0 &&
      commits.length === 2 &&
      commits.every((commit) => OBJECT_NAME.test(commit))
      ? commits.join(":")
      : undefined;
  }

  /**
   * The branch or commit to compare with: `ref` when given, otherwise the branch `origin/HEAD`
   * points at, then a local `main`, then `master`.
   */
  async resolveBase(ref?: string): Promise<GitBase | GitUnavailable> {
    if (ref !== undefined) {
      // Refused before git sees it: a ref is a positional argument, and one starting with `-`
      // would be read as an option.
      if (ref.length === 0 || ref.startsWith("-")) {
        return unavailable(
          "invalid-ref",
          `"${ref}" is not a branch, tag or commit name.`,
          "Name the base by a branch, a tag or a commit id.",
        );
      }
      const commit = await this.resolveCommit(ref);
      if (commit !== undefined) {
        return { ref, commit };
      }
      // Comparing with the last commit before there is one — a fresh repository, an orphan branch —
      // is an ordinary request, and "fetch the branch first" would send the reader the wrong way.
      // Decided from the repository rather than the spelling: a `HEAD` naming a commit git cannot
      // read is a damaged repository, which "make a first commit" would misdescribe just as badly.
      if ((ref === "HEAD" || ref === "@") && (await this.headIsUnborn())) {
        return unavailable(
          "base-not-found",
          "HEAD has no commits yet.",
          "Make a first commit to compare with it.",
        );
      }
      return unavailable(
        "base-not-found",
        `"${ref}" does not name a commit in this repository.`,
        "Check the name, or fetch the branch first.",
      );
    }

    const candidates: { ref: string; fullRef: string }[] = [];
    const remoteHead = await this.run([
      "symbolic-ref",
      "--quiet",
      "refs/remotes/origin/HEAD",
    ]);
    const remoteTarget = remoteHead.stdout.toString("utf8").trim();
    if (remoteHead.exitCode === 0 && remoteTarget.startsWith("refs/remotes/")) {
      candidates.push({
        ref: remoteTarget.slice("refs/remotes/".length),
        fullRef: remoteTarget,
      });
    }
    candidates.push(
      { ref: "main", fullRef: "refs/heads/main" },
      { ref: "master", fullRef: "refs/heads/master" },
    );
    for (const candidate of candidates) {
      const commit = await this.resolveCommit(candidate.fullRef);
      if (commit !== undefined) {
        return { ref: candidate.ref, commit, fullRef: candidate.fullRef };
      }
    }
    return unavailable(
      "base-not-found",
      "No base branch was found: origin/HEAD is not set and there is no main or master branch.",
      "Name the branch to compare with.",
    );
  }

  /**
   * Where the current branch left `base`: the commit a review compares with, so that commits made
   * on the base branch after the fork never read as changes made here.
   */
  async mergeBase(base: GitBase): Promise<string | GitUnavailable> {
    const output = await this.run([
      "merge-base",
      requireObjectName(base.commit),
      "HEAD",
    ]);
    const commit = output.stdout.toString("utf8").trim();
    if (output.exitCode === 0 && OBJECT_NAME.test(commit)) {
      return commit;
    }
    // Asked now rather than at open: a clone deepened while a host runs is no longer shallow.
    const shallow = await this.run(["rev-parse", "--is-shallow-repository"]);
    if (shallow.stdout.toString("utf8").trim() === "true") {
      return unavailable(
        "shallow-history",
        `This is a shallow clone, and the history it has does not reach back to where the branch left ${base.ref}.`,
        "Fetch more history with git fetch --deepen=<n>, or all of it with git fetch --unshallow.",
      );
    }
    if ((await this.headCommit()) === undefined) {
      return unavailable(
        "base-not-found",
        "HEAD has no commits yet.",
        "Make a first commit to compare with a base.",
      );
    }
    return unavailable(
      "base-not-found",
      `HEAD and ${base.ref} share no history.`,
      "Name a base branch this branch was made from.",
    );
  }

  /**
   * The paths under the host root that differ between `from` and the work tree — tracked changes,
   * staged or not, and untracked files git does not ignore — or between `from` and `HEAD` when
   * `worktree` is false. Sorted by path.
   *
   * Git detects renames only between paths it tracks, so a file moved on disk and not yet staged
   * reads as a deletion and an addition.
   *
   * `alsoPaths` are files outside the host root to report as well, named relative to the root with
   * `..` segments — the config file a parent directory holds, which decides what the corpus under
   * the root is. A path that leaves the work tree has no history to compare and is skipped.
   */
  async changedPaths(
    from: string,
    options: { worktree: boolean; alsoPaths?: readonly string[] },
  ): Promise<GitChange[]> {
    // Each outside path by its top-level name, to be found in git's output and named back the way
    // the caller did.
    const outside = new Map<string, string>();
    for (const relPath of options.alsoPaths ?? []) {
      const topLevel = this.resolveTopLevel(relPath);
      if (topLevel !== undefined && this.fromTopLevel(topLevel) === undefined) {
        outside.set(topLevel, relPath);
      }
    }
    const pathspec =
      this.prefix === ""
        ? []
        : ["--", this.prefix, ...[...outside.keys()].sort(compareStrings)];
    // Two snapshots compared as trees, through the plumbing command: it never looks at the work
    // tree, so it has no stat data to refresh and nothing to write.
    const committedOutput = await this.mustRun([
      "diff-tree",
      "-r",
      "--name-status",
      "-z",
      "-M",
      ...SAFE_DIFF_FLAGS,
      requireObjectName(from),
      "HEAD",
      ...pathspec,
    ]);
    const committed = parseNameStatus(committedOutput.stdout.toString("utf8"));

    let changes = committed;
    if (options.worktree) {
      // The work tree through `status` rather than `diff <commit>`. Porcelain `diff` rewrites
      // `.git/index` whenever it finds files whose stat changed but whose content did not, and
      // `GIT_OPTIONAL_LOCKS=0` does not stop it; `status` is the command that variable is defined
      // for, comparing content in memory and writing nothing. It reports `HEAD` to the work tree, so
      // the two halves are composed into one comparison from `from`.
      const statusOutput = await this.mustRun([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=all",
        "--find-renames",
        ...pathspec,
      ]);
      changes = composeChanges(
        committed,
        parseStatusPorcelain(statusOutput.stdout.toString("utf8")),
      );
    }

    const toRoot = (topLevel: string) =>
      this.fromTopLevel(topLevel) ?? outside.get(topLevel);
    return changes
      .map((change) => fromTopLevelChange(change, toRoot))
      .filter((change): change is GitChange => change !== undefined)
      .sort((left, right) => compareStrings(left.path, right.path));
  }

  /**
   * The text of each path at `commit`, decoded as UTF-8 the way the corpus is read from disk. A path
   * absent at that commit, or not a file there, has no entry.
   */
  async readBlobs(
    commit: string,
    paths: readonly string[],
  ): Promise<Map<string, string>> {
    const name = requireObjectName(commit);
    // `cat-file --batch` reads one request per line, so a name holding a line break cannot be asked
    // for; git itself cannot express it in this protocol either. A path that leaves the work tree is
    // in no commit.
    const requested = paths.flatMap((relPath) => {
      const topLevel = /[\n\r]/.test(relPath)
        ? undefined
        : this.resolveTopLevel(relPath);
      return topLevel === undefined ? [] : [{ relPath, topLevel }];
    });
    const texts = new Map<string, string>();
    if (requested.length === 0) {
      return texts;
    }
    // One process for every file rather than one per file.
    const output = await this.mustRun(
      ["cat-file", "--batch"],
      requested.map(({ topLevel }) => `${name}:${topLevel}\n`).join(""),
    );

    const buffer = output.stdout;
    let offset = 0;
    for (const { relPath } of requested) {
      const lineEnd = buffer.indexOf(0x0a, offset);
      if (lineEnd === -1) {
        break;
      }
      const header = buffer.toString("utf8", offset, lineEnd);
      offset = lineEnd + 1;
      // `<object> <type> <size>` and then exactly `size` bytes and a newline; any other header
      // (`missing`, `ambiguous`) has no body.
      const match = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
      if (match === null) {
        continue;
      }
      const size = Number(match[2]);
      if (match[1] === "blob") {
        texts.set(relPath, buffer.toString("utf8", offset, offset + size));
      }
      offset += size + 1;
    }
    return texts;
  }

  /**
   * The commits that last touched a file, newest first, following it across renames: at most
   * `limit`. Uncommitted edits are not commits and are not listed. Empty for a file git does not
   * track or a repository with no commit yet.
   */
  async fileHistory(relPath: string, limit: number): Promise<FileCommit[]> {
    const output = await this.run([
      "log",
      "--follow",
      "-z",
      `--max-count=${String(Math.max(1, Math.floor(limit)))}`,
      // Fields apart by a unit separator, which no hash, date or name holds; `-z` ends each record
      // with a NUL, so a subject can be anything a commit message's first line can be.
      "--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s",
      "--no-decorate",
      "--no-show-signature",
      ...SAFE_DIFF_FLAGS,
      "--",
      this.toTopLevel(relPath),
    ]);
    if (output.exitCode !== 0) {
      return [];
    }
    return output.stdout
      .toString("utf8")
      .split("\0")
      .map((record) => record.replace(/^\n+/, ""))
      .filter((record) => record.length > 0)
      .flatMap((record): FileCommit[] => {
        const [commit = "", short = "", time = "", author = "", subject = ""] =
          record.split("\x1f");
        return OBJECT_NAME.test(commit)
          ? [{ commit, short, date: isoDate(Number(time)), author, subject }]
          : [];
      });
  }

  /**
   * Who last touched each line of the file as it is in the work tree: one entry per line, numbered
   * from 1. A line not yet committed has `commit: undefined`. Empty when git cannot blame the file —
   * not tracked, or no commit yet — so a host can simply show nothing.
   */
  async blame(relPath: string): Promise<(BlameLine | undefined)[]> {
    const output = await this.run([
      "blame",
      "--porcelain",
      "--no-textconv",
      "--",
      this.toTopLevel(relPath),
    ]);
    if (output.exitCode !== 0) {
      return [];
    }
    return parseBlamePorcelain(output.stdout.toString("utf8"));
  }

  // Whether `HEAD` names a branch that has no commit yet. `symbolic-ref` answers only while `HEAD`
  // names a branch, and `rev-parse --verify` on that branch's ref fails only when the ref does not
  // exist: resolving a ref never reads the object it names, so a ref left pointing at a missing
  // commit still resolves and is not mistaken for a branch waiting for its first commit.
  private async headIsUnborn(): Promise<boolean> {
    const head = await this.run(["symbolic-ref", "--quiet", "HEAD"]);
    const branch = head.stdout.toString("utf8").trim();
    if (head.exitCode !== 0 || !branch.startsWith("refs/heads/")) {
      return false;
    }
    const resolved = await this.run([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      branch,
    ]);
    return resolved.exitCode !== 0;
  }

  private async resolveCommit(ref: string): Promise<string | undefined> {
    const output = await this.run([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${ref}^{commit}`,
    ]);
    const commit = output.stdout.toString("utf8").trim();
    return output.exitCode === 0 && OBJECT_NAME.test(commit)
      ? commit
      : undefined;
  }

  // Every command this class starts goes through here, and the repository's filter drivers and
  // protocol settings are listed again for each one rather than once at open. A long-lived host —
  // the viewer runs for hours — outlives the config it opened with: a checkout activates an
  // `[includeIf "onbranch:…"]`, a pull rewrites a tracked file an `[include] path` names, a hand
  // edit lands in `.git/config`. A driver listed only at open would then be unknown, so not emptied,
  // and `status` would run its `clean` command. The scan is one `git config` read, which runs
  // nothing; what is left is the moment between the scan and the command it guards.
  private async run(args: readonly string[], input?: string) {
    const { cwd, inherited } = this.launch;
    // Read with only the fixed settings every call carries, which is all `git config` needs: it
    // reads files and starts nothing.
    const overrides = await repositoryConfigOverrides({
      cwd,
      env: gitEnvironment(inherited),
    });
    return runGit(
      { cwd, env: gitEnvironment(inherited, overrides) },
      args,
      input,
    );
  }

  private async mustRun(args: string[], input?: string) {
    const output = await this.run(args, input);
    if (output.exitCode !== 0) {
      throw new GitCommandError(args[0] ?? "", output.exitCode, output.stderr);
    }
    return output;
  }

  private toTopLevel(relPath: string): string {
    return this.prefix === "" ? relPath : `${this.prefix}/${relPath}`;
  }

  // `toTopLevel` with `..` segments resolved, for a path that may climb out of the host root —
  // git's `<commit>:<path>` and its pathspecs do not resolve them — or `undefined` when it climbs out
  // of the work tree too, or is absolute (a config on another Windows drive has no relative name).
  private resolveTopLevel(relPath: string): string | undefined {
    if (path.posix.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) {
      return undefined;
    }
    const resolved = path.posix.normalize(this.toTopLevel(relPath));
    return resolved === "." || resolved === ".." || resolved.startsWith("../")
      ? undefined
      : resolved;
  }

  private fromTopLevel(topRelative: string): string | undefined {
    if (this.prefix === "") {
      return topRelative;
    }
    return topRelative.startsWith(`${this.prefix}/`)
      ? topRelative.slice(this.prefix.length + 1)
      : undefined;
  }
}

// A change restated from the work tree's top level to the host root by `toRoot`, which names a path
// the root cannot see `undefined`. A rename that crosses the edge of what it sees is an addition or a
// deletion from inside it.
function fromTopLevelChange(
  change: GitChange,
  toRoot: (topLevel: string) => string | undefined,
): GitChange | undefined {
  const relPath = toRoot(change.path);
  const oldPath =
    change.oldPath === undefined ? undefined : toRoot(change.oldPath);
  if (change.status !== "R") {
    return relPath === undefined ? undefined : { ...change, path: relPath };
  }
  if (relPath !== undefined && oldPath !== undefined) {
    return { status: "R", path: relPath, oldPath };
  }
  if (relPath !== undefined) {
    return { status: "A", path: relPath };
  }
  return oldPath === undefined ? undefined : { status: "D", path: oldPath };
}

/**
 * Parse `status --porcelain=v1 -z` into changes from `HEAD` to the work tree. Each entry is `XY`
 * — `X` the index against `HEAD`, `Y` the work tree against the index — a space and a path; a
 * rename or a copy adds the source path as the next field. Only what the two columns mean together
 * matters here: whether the path exists at `HEAD`, whether it exists on disk, and where it came from.
 */
export function parseStatusPorcelain(text: string): GitChange[] {
  const fields = text.split("\0");
  const changes: GitChange[] = [];
  let index = 0;
  while (index < fields.length) {
    const entry = fields[index] ?? "";
    if (entry.length < 4) {
      break;
    }
    const x = entry[0];
    const y = entry[1];
    const filePath = entry.slice(3);
    const renamedOrCopied = x === "R" || x === "C" || y === "R" || y === "C";
    const source = renamedOrCopied ? (fields[index + 1] ?? "") : undefined;
    index += renamedOrCopied ? 2 : 1;

    const change = statusChange(`${x ?? " "}${y ?? " "}`, filePath, source);
    if (change !== undefined) {
      changes.push(change);
    }
  }
  return changes;
}

function statusChange(
  xy: string,
  filePath: string,
  source: string | undefined,
): GitChange | undefined {
  const untrackedOrUnmerged = untrackedOrUnmergedChange(xy, filePath);
  if (untrackedOrUnmerged !== undefined) {
    return untrackedOrUnmerged;
  }
  const deletedOnDisk = xy[1] === "D";
  if (source !== undefined) {
    // A copy leaves its source in place, so only the new path is a change.
    if (xy.includes("C")) {
      return deletedOnDisk ? undefined : { status: "A", path: filePath };
    }
    return deletedOnDisk
      ? { status: "D", path: source }
      : { status: "R", path: filePath, oldPath: source };
  }
  if (xy.startsWith("A") || xy[1] === "A") {
    // Staged as new, then removed from disk: it never existed at either end.
    return deletedOnDisk ? undefined : { status: "A", path: filePath };
  }
  if (xy.startsWith("D") || deletedOnDisk) {
    return { status: "D", path: filePath };
  }
  return { status: "M", path: filePath };
}

// The change for an untracked path or an unmerged one, or undefined for any other status code.
function untrackedOrUnmergedChange(
  xy: string,
  filePath: string,
): GitChange | undefined {
  if (xy === "??") {
    return { status: "A", path: filePath };
  }
  // Unmerged paths, by which side has the file: deleted on both sides is gone; added only by the
  // other side, or deleted by ours, is absent at `HEAD` and present on disk; the rest exist at both.
  if (xy === "DD") {
    return { status: "D", path: filePath };
  }
  if (xy === "UA" || xy === "DU") {
    return { status: "A", path: filePath };
  }
  if (xy.includes("U") || xy === "AA") {
    return { status: "M", path: filePath };
  }
  return undefined;
}

/**
 * Compose two consecutive change lists — `first` from snapshot A to B, `second` from B to C — into
 * the changes from A to C, following each path back through both: a rename in one and a rename of
 * the result in the other is one rename, an addition later deleted is nothing, a deletion and a
 * re-creation at the same path is a modification.
 *
 * A path changed in `first` and changed back in `second` still reads as modified: telling that
 * apart takes the texts, which the diff of the two texts settles anyway.
 */
export function composeChanges(
  first: readonly GitChange[],
  second: readonly GitChange[],
): GitChange[] {
  // For each side: every path it touches at its newer snapshot, mapped to the path it came from at
  // the older one (`null` when it was added), and the older paths that no longer exist.
  const side = (changes: readonly GitChange[]) => {
    const origin = new Map<string, string | null>();
    const gone = new Set<string>();
    for (const change of changes) {
      if (change.status === "D") {
        gone.add(change.path);
      } else if (change.status === "R" && change.oldPath !== undefined) {
        origin.set(change.path, change.oldPath);
        gone.add(change.oldPath);
      } else {
        origin.set(change.path, change.status === "A" ? null : change.path);
      }
    }
    return { origin, gone };
  };
  const early = side(first);
  const late = side(second);
  const originAtStart = (middle: string | null): string | null => {
    if (middle === null) {
      return null;
    }
    return early.origin.has(middle)
      ? (early.origin.get(middle) ?? null)
      : middle;
  };

  const result = new Map<string, GitChange>();
  const reached = new Set<string>();
  const endPaths = new Set([
    ...late.origin.keys(),
    ...[...early.origin.keys()].filter((middle) => !late.gone.has(middle)),
  ]);
  for (const end of endPaths) {
    const middle = late.origin.has(end) ? (late.origin.get(end) ?? null) : end;
    const start = originAtStart(middle);
    if (start === null) {
      result.set(end, { status: "A", path: end });
      continue;
    }
    reached.add(start);
    result.set(
      end,
      start === end
        ? { status: "M", path: end }
        : { status: "R", path: end, oldPath: start },
    );
  }

  const removedAtStart = new Set([
    ...early.gone,
    ...[...late.gone].map(originAtStart),
  ]);
  for (const start of removedAtStart) {
    if (start === null || reached.has(start)) {
      continue;
    }
    const addedThere = result.get(start);
    // Removed and then created again at the same path: it exists at both ends, so it changed.
    result.set(
      start,
      addedThere?.status === "A"
        ? { status: "M", path: start }
        : { status: "D", path: start },
    );
  }
  return [...result.values()];
}

// The calendar date of a commit time, in UTC: the same answer on every machine, whatever its zone.
function isoDate(seconds: number): string {
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString().slice(0, 10)
    : "";
}

// The all-zero name blame gives lines the work tree changed since the last commit.
const UNCOMMITTED = /^0+$/;

/**
 * Parse `blame --porcelain`: per line a header `<commit> <original line> <final line> [<count>]`,
 * the commit's details the first time that commit appears (`author`, `committer-time`, `summary`,
 * among others), then the line's text after a tab. Returns one entry per final line, by its number.
 */
export function parseBlamePorcelain(text: string): (BlameLine | undefined)[] {
  const commits = new Map<string, FileCommit>();
  const lines: (BlameLine | undefined)[] = [];
  let current: { commit: string; line: number } | undefined;
  for (const row of text.split("\n")) {
    if (row.startsWith("\t")) {
      if (current !== undefined) {
        const details = commits.get(current.commit);
        lines[current.line - 1] = UNCOMMITTED.test(current.commit)
          ? {}
          : (details ?? { commit: current.commit });
      }
      current = undefined;
      continue;
    }
    const header = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)(?: \d+)?$/.exec(row);
    if (header !== null) {
      const commit = header[1]!;
      current = { commit, line: Number(header[2]) };
      if (!commits.has(commit)) {
        commits.set(commit, {
          commit,
          short: commit.slice(0, 7),
          date: "",
          author: "",
          subject: "",
        });
      }
      continue;
    }
    const details =
      current === undefined ? undefined : commits.get(current.commit);
    if (details === undefined) {
      continue;
    }
    const space = row.indexOf(" ");
    const key = space === -1 ? row : row.slice(0, space);
    const value = space === -1 ? "" : row.slice(space + 1);
    if (key === "author") {
      details.author = value;
    } else if (key === "committer-time") {
      details.date = isoDate(Number(value));
    } else if (key === "summary") {
      details.subject = value;
    }
  }
  return lines;
}

// A one-letter name-status other than a rename or a copy: an addition, a deletion, or — for every
// other letter, a type change included — a modification.
function addedDeletedOrModified(kind: string | undefined): "A" | "D" | "M" {
  if (kind === "A" || kind === "D") {
    return kind;
  }
  return "M";
}

/**
 * Parse `diff --name-status -z`: a status, then one path, or two for a rename or a copy (old, new).
 * Paths are as git printed them, relative to the work tree's top level.
 */
export function parseNameStatus(text: string): GitChange[] {
  const fields = text.split("\0");
  const changes: GitChange[] = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index] ?? "";
    if (status === "") {
      break;
    }
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = fields[index + 1] ?? "";
      const newPath = fields[index + 2] ?? "";
      changes.push(
        kind === "R"
          ? { status: "R", path: newPath, oldPath }
          : { status: "A", path: newPath },
      );
      index += 3;
      continue;
    }
    const filePath = fields[index + 1] ?? "";
    changes.push({ status: addedDeletedOrModified(kind), path: filePath });
    index += 2;
  }
  return changes;
}
