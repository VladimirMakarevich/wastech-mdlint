import { spawn } from "node:child_process";
import path from "node:path";

// Every `git` process the product starts goes through `runGit`. Git is run on whatever repository a
// user points a host at — possibly an archive unpacked from somewhere else, `.git/config` included —
// and that config can name programs git starts on its own during a plain read: an fsmonitor hook on
// any work-tree comparison, a filter driver's `clean` command on every file whose stat changed, an
// external diff or a textconv driver on a diff. Nothing here may let one run. The defenses are in
// three places: the environment built below, the config every call carries (this file plus the
// filter overrides `openGitRepository` adds once it knows the repository), and the flags each diff
// call passes (`--no-ext-diff --no-textconv`).

/** Raised when git ran and failed in a way none of the expected states explains. */
export class GitCommandError extends Error {
  // Kept for a host to log on its own terminal, never put in the message: git quotes absolute
  // paths in its errors, and a message reaches pages and JSON that must not say where the checkout
  // lives.
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(subcommand: string, exitCode: number | null, stderr: string) {
    super(
      exitCode === null
        ? `git ${subcommand} did not finish`
        : `git ${subcommand} failed with exit code ${String(exitCode)}`,
    );
    this.name = "GitCommandError";
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/** `git` is not installed, or not on an absolute `PATH` entry. */
export class GitNotFoundError extends Error {
  constructor() {
    super("git was not found on PATH");
    this.name = "GitNotFoundError";
  }
}

export type GitInvocation = {
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type GitOutput = {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
};

// The three variables that choose the user's own config files survive; every other inherited
// `GIT_*` is dropped. A viewer started from inside a git hook or a `rebase --exec` inherits
// `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` naming the repository that hook runs for, and would
// read that one instead of the one it was pointed at; `GIT_EXTERNAL_DIFF` names a program to run;
// `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` carry a parent's `-c` settings, which would override
// the ones set below. The config-file selectors are kept because they are the user's setup, not the
// repository's: a user who keeps the global config elsewhere would otherwise lose a `safe.directory`
// entry it holds. So is `GIT_CEILING_DIRECTORIES`, which only stops the search for a repository
// from climbing above directories the user named — into a dotfiles repository at the home
// directory, say.
const KEPT_GIT_VARIABLES = new Set([
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CEILING_DIRECTORIES",
]);

// Locale variables are replaced by `LC_ALL=C`, so git's own error messages — matched on to tell "not
// a repository" from "owned by another user" — are the untranslated ones on every machine.
const DROPPED_LOCALE_VARIABLES = new Set(["LANG", "LANGUAGE", "LC_ALL"]);

/**
 * Settings every call carries, passed through git's environment config (`GIT_CONFIG_COUNT`,
 * `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`) rather than `-c`. They outrank every config file,
 * as `-c` does, but a key travels whole: `-c` splits its argument at the first `=`, so a filter
 * driver named with an `=` in it could not be overridden that way and would run.
 */
const BASE_CONFIG: readonly (readonly [string, string])[] = [
  // An fsmonitor hook set in repository config is a program git starts on any work-tree comparison.
  ["core.fsmonitor", "false"],
  // With `-z` output git already leaves names unquoted; this keeps any non-`-z` output the same.
  ["core.quotePath", "false"],
  // `log` and `blame` would otherwise start gpg to check each signed commit when a config asks for
  // signatures to be shown, and gpg is a program the repository's config can name.
  ["log.showSignature", "false"],
];

/**
 * The environment every git call runs with, built from the host's.
 *
 * `PATH` keeps only absolute entries. An empty or `.` entry is resolved against the child's working
 * directory — the repository — so a `git` executable committed there would be the one that runs.
 */
export function gitEnvironment(
  inherited: NodeJS.ProcessEnv,
  extraConfig: readonly (readonly [string, string])[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(inherited)) {
    // Windows treats variable names case-insensitively, and a copied environment keeps whatever
    // case it had (`Path` is the usual spelling there).
    const upper = name.toUpperCase();
    if (upper.startsWith("GIT_") && !KEPT_GIT_VARIABLES.has(upper)) {
      continue;
    }
    if (DROPPED_LOCALE_VARIABLES.has(upper)) {
      continue;
    }
    env[name] =
      upper === "PATH" && value !== undefined
        ? absolutePathEntries(value)
        : value;
  }

  const config = [...BASE_CONFIG, ...extraConfig];
  config.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${String(index)}`] = key;
    env[`GIT_CONFIG_VALUE_${String(index)}`] = value;
  });
  return {
    ...env,
    GIT_CONFIG_COUNT: String(config.length),
    // A work-tree comparison may refresh the index's cached stat data and write `.git/index`; this
    // makes it skip that write, so a reader never changes the repository it reads.
    GIT_OPTIONAL_LOCKS: "0",
    // Nothing run here may stop to ask for a password, and nothing may page its output.
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    // A pathspec is always a directory prefix this module built, never a pattern: a folder named
    // `docs*` must limit a diff to itself, not to every folder it matches.
    GIT_LITERAL_PATHSPECS: "1",
    LC_ALL: "C",
  };
}

function absolutePathEntries(value: string): string {
  return value
    .split(path.delimiter)
    .filter((entry) => path.isAbsolute(entry.replace(/^"(.*)"$/, "$1")))
    .join(path.delimiter);
}

// Generous: a blob read returns every requested file in one stream, and a change list of a large
// monorepo is long. The cap exists so a runaway output fails rather than exhausting memory.
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * Run `git <args>` without a shell. Resolves with the exit code for the caller to judge — several
 * expected states (no such ref, no common history) are a non-zero exit — and rejects only when git
 * could not be started, timed out, or produced more output than any legitimate call does.
 */
export function runGit(
  invocation: GitInvocation,
  args: readonly string[],
  input?: string,
): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    // `--no-pager` as well as `GIT_PAGER`: a pager runs only on a terminal, which a child with piped
    // output never is, but the flag makes that independent of how git decides it.
    const child = spawn("git", ["--no-pager", ...args], {
      cwd: invocation.cwd,
      env: invocation.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    const stderr: Buffer[] = [];
    let failure: Error | undefined;

    const timer = setTimeout(() => {
      failure = new GitCommandError(args[0] ?? "", null, "timed out");
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        failure = new GitCommandError(args[0] ?? "", null, "output too large");
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    // Git may exit before reading all of its input (a fatal error on the first line); the broken
    // pipe that follows is not the failure worth reporting — the exit code is.
    child.stdin.on("error", () => {});
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new GitNotFoundError() : error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (failure !== undefined) {
        reject(failure);
      } else if (code === null) {
        reject(new GitCommandError(args[0] ?? "", null, stderrText));
      } else {
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdout),
          stderr: stderrText,
        });
      }
    });
    child.stdin.end(input);
  });
}
