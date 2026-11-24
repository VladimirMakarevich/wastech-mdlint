import path from "node:path";

// Where the viewer keeps what it remembers for a user between runs — today, which documents they
// have reviewed. Never the work tree, where it would show up as an untracked file and could be
// committed, and never `.git`, which belongs to git and is shared by everyone with access to the
// clone. Each platform's own place for an application's local state: what is kept there is
// rebuilt by reviewing again, so it is state, not configuration, and it stays on this machine
// rather than roaming with a Windows profile.

/**
 * The state directory when `--state-dir` does not name one. Pure, with the platform, environment
 * and home directory passed in, so each platform's answer is testable on any machine; the matching
 * `path` flavor is used for each, so a Windows answer is a Windows path wherever it is computed.
 */
export function defaultStateDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    const base =
      local !== undefined && path.win32.isAbsolute(local)
        ? local
        : path.win32.join(home, "AppData", "Local");
    return path.win32.join(base, "wastech-mdlint", "viewer");
  }
  if (platform === "darwin") {
    return path.posix.join(
      home,
      "Library",
      "Application Support",
      "wastech-mdlint",
      "viewer",
    );
  }
  // The XDG base directory specification has a relative value ignored, as if it were unset: it would
  // otherwise resolve against whatever directory the viewer happened to start in.
  const xdg = env.XDG_STATE_HOME;
  const base =
    xdg !== undefined && path.posix.isAbsolute(xdg)
      ? xdg
      : path.posix.join(home, ".local", "state");
  return path.posix.join(base, "wastech-mdlint", "viewer");
}
