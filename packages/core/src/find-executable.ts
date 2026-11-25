import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

// A program a host starts by bare name is looked up by libuv, which on Windows searches the
// process's working directory before `PATH`, whatever `PATH` holds, unless the
// `NoDefaultCurrentDirectoryInExePath` variable is set, as almost no machine has it. A host runs in,
// or points git at, a repository that may have come from anywhere, so a `git.exe` or `explorer.exe`
// committed to it would be the program that runs. Every program the product starts is therefore
// found here, on `PATH`'s absolute entries only, and started by its absolute path.
//
// On Windows a name is tried with `.com` and then `.exe`, the order libuv uses: those are the only
// kinds a process can be started from without a shell, so a `.cmd` or `.bat` that `PATHEXT` would
// admit could not be spawned anyway. Elsewhere the file must be executable, as `execvp` requires.
//
// A lookup that found the program is remembered per name and `PATH` value, since a review starts
// git once per call; one that found nothing is not, so a program installed while a long-lived host
// runs is found by the next call.
const resolved = new Map<string, string>();

/**
 * The absolute path of the executable `name` that `env`'s `PATH` names, or `undefined` when none of
 * its absolute entries holds one. `name` is a bare program name without an extension.
 */
export async function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const pathValue = pathVariable(env, platform) ?? "";
  const key = `${platform}\0${name}\0${pathValue}`;
  const cached = resolved.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const names = platform === "win32" ? [`${name}.com`, `${name}.exe`] : [name];
  const directories = pathValue
    .split(platform === "win32" ? ";" : ":")
    .map(unquoted)
    .filter((entry) => isRootedPathEntry(entry, platform));
  for (const directory of directories) {
    for (const candidate of names.map((file) =>
      pathApi.join(directory, file),
    )) {
      if (await isExecutableFile(candidate, platform)) {
        resolved.set(key, candidate);
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Drop `executable` from the lookup cache - for a caller whose start of it failed with `ENOENT`,
 * meaning it was uninstalled since it was found, so the next lookup searches `PATH` again.
 */
export function forgetExecutable(executable: string): void {
  for (const [key, value] of resolved) {
    if (value === executable) {
      resolved.delete(key);
    }
  }
}

/**
 * Whether a `PATH` entry names one fixed directory, independent of where the process runs. On
 * Windows that takes a drive letter or a UNC share: `path.win32.isAbsolute` also accepts `\tools`,
 * which is rooted at the *current* drive and so names a folder of the repository when the host runs
 * at a drive's root.
 */
export function isRootedPathEntry(
  entry: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") {
    return path.posix.isAbsolute(entry);
  }
  return /^[A-Za-z]:[\\/]/.test(entry) || /^[\\/]{2}[^\\/]/.test(entry);
}

// Windows allows a `PATH` entry in double quotes, the way an installer writes one holding `;`.
export function unquoted(entry: string): string {
  return entry.replace(/^"(.*)"$/, "$1");
}

// Windows names are case-insensitive and a copied environment keeps whatever case it had (`Path`
// is the usual spelling there); the exact `PATH` wins when both spellings are present, as it is the
// one a POSIX child would see.
function pathVariable(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  if (env.PATH !== undefined || platform !== "win32") {
    return env.PATH;
  }
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  return key === undefined ? undefined : env[key];
}

async function isExecutableFile(
  candidate: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    if (!(await stat(candidate)).isFile()) {
      return false;
    }
    // Windows has no execute bit: `X_OK` there only repeats the existence check.
    if (platform !== "win32") {
      await access(candidate, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}
