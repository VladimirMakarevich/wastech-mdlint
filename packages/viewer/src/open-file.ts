import { spawn } from "node:child_process";
import path from "node:path";

import { findExecutable } from "@wastech-mdlint/core";

import { isLoopbackHost } from "./security.js";

// Opening the config file from its page: showing it in the system's file manager, or handing it to
// whatever application the system opens such a file with. Each is one program the operating system
// itself provides, run with the file's path as an argument list — never through a shell, where a
// space or an ampersand in a checkout's path is the ordinary case and would become part of a command.

export type OpenAction = "reveal" | "open";

/**
 * Why opening a file is refused for a viewer bound to `host`, or `undefined` when it is allowed.
 *
 * Opening starts a program on the machine running the viewer. A reader on another machine, reaching
 * a viewer bound with `--host`, would make a window appear on a desktop that is not theirs — so,
 * like saving the config, it is an action for a loopback binding only.
 */
export function openRefusal(host: string): string | undefined {
  return isLoopbackHost(host)
    ? undefined
    : "Opening the config is off: the viewer is reachable from other machines (--host), and would start a program on this one for them.";
}

export type LaunchCommand = {
  command: string;
  args: string[];
  // Windows only: pass `args` exactly as written. Explorer parses its own command line and expects
  // `/select,"C:\path"` as one piece, which Node's usual quoting would wrap in a second set of quotes
  // that Explorer does not understand.
  windowsVerbatimArguments?: boolean;
};

/**
 * The program and arguments that reveal or open `absolutePath` on `platform`, or `undefined` for a
 * path that cannot be passed safely.
 *
 * - Windows: Explorer — `/select,` opens the folder with the file selected; a bare path opens the
 *   file with its associated application, as a double click would. Quoted by hand for the verbatim
 *   command line, which is safe because a Windows path cannot contain a double quote; one that
 *   somehow does is refused rather than allowed to end the quoting early.
 * - macOS: `open -R` reveals in Finder, `open` uses the default application.
 * - Elsewhere: `xdg-open`, the freedesktop launcher. It has no portable way to select a file in a
 *   file manager, so revealing opens the folder that holds it.
 */
export function openCommand(
  platform: NodeJS.Platform,
  action: OpenAction,
  absolutePath: string,
): LaunchCommand | undefined {
  if (platform === "win32") {
    if (absolutePath.includes('"')) {
      return undefined;
    }
    return {
      command: "explorer",
      args: [
        action === "reveal" ? `/select,"${absolutePath}"` : `"${absolutePath}"`,
      ],
      windowsVerbatimArguments: true,
    };
  }
  if (platform === "darwin") {
    return {
      command: "open",
      args: action === "reveal" ? ["-R", absolutePath] : [absolutePath],
    };
  }
  return {
    command: "xdg-open",
    args: [
      action === "reveal" ? path.posix.dirname(absolutePath) : absolutePath,
    ],
  };
}

/** Starts a command and resolves once it is running; rejects if it could not be started at all. */
export type Launcher = (command: LaunchCommand) => Promise<void>;

/**
 * Start the program detached and stop tracking it: the file manager or editor it opens is the
 * reader's to close, and the viewer must neither wait for it nor take it down when it exits. Only a
 * failure to start (no such program) is reported. What the program does after that is not: Explorer
 * exits with status 1 even when it succeeds, so an exit status says nothing either way.
 */
export const launchDetached: Launcher = async (command) => {
  // Never by bare name: on Windows that searches the viewer's working directory — usually the
  // repository it serves — before `PATH`, so an `explorer.exe` committed to it would be what a click
  // on "Show in folder" runs. An absolute `command` is the caller's own choice and is used as given.
  const executable = path.isAbsolute(command.command)
    ? command.command
    : await findExecutable(command.command, process.env);
  if (executable === undefined) {
    throw new Error("the program was not found on PATH");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, command.args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
    });
    // Node's own message names the absolute path it tried, which a page must not show.
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code ?? "it could not be started"));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};
