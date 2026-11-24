import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { launchDetached, openCommand, openRefusal } from "../src/open-file.js";

// What runs when the config page asks to show or open the config file. Every case is an argument
// list for a program the system provides, never a shell command line, so a space, an ampersand or a
// quote in a checkout's path stays part of the path.
describe("openCommand", () => {
  const windowsPath = String.raw`C:\Users\Jo Doe\R&D repo\wastech-mdlint.config.json`;
  const posixPath = "/home/jo doe/r&d repo/wastech-mdlint.config.json";

  // Explorer reads its own command line, so the arguments go to it exactly as written: `/select,`
  // glued to the quoted path selects the file in its folder, and a quoted path alone opens it.
  it("uses Explorer on Windows, quoted by hand for its verbatim command line", () => {
    expect(openCommand("win32", "reveal", windowsPath)).toEqual({
      command: "explorer",
      args: [`/select,"${windowsPath}"`],
      windowsVerbatimArguments: true,
    });
    expect(openCommand("win32", "open", windowsPath)).toEqual({
      command: "explorer",
      args: [`"${windowsPath}"`],
      windowsVerbatimArguments: true,
    });
  });

  // A double quote cannot occur in a Windows path; one that did would close the hand-made quoting
  // and let the rest of the path become arguments of their own.
  it("refuses a Windows path that would break out of its quotes", () => {
    expect(openCommand("win32", "open", 'C:\\a" /b')).toBeUndefined();
  });

  it("uses open on macOS, revealing in Finder with -R", () => {
    expect(openCommand("darwin", "reveal", posixPath)).toEqual({
      command: "open",
      args: ["-R", posixPath],
    });
    expect(openCommand("darwin", "open", posixPath)).toEqual({
      command: "open",
      args: [posixPath],
    });
  });

  // xdg-open has no portable way to select a file in a file manager, so revealing opens its folder.
  it("uses xdg-open elsewhere, revealing the folder that holds the file", () => {
    expect(openCommand("linux", "reveal", posixPath)).toEqual({
      command: "xdg-open",
      args: ["/home/jo doe/r&d repo"],
    });
    expect(openCommand("freebsd", "open", posixPath)).toEqual({
      command: "xdg-open",
      args: [posixPath],
    });
  });
});

// Opening starts a program on the machine running the viewer; a reader on another machine must not
// be able to make windows appear on it.
describe("openRefusal", () => {
  it.each(["127.0.0.1", "localhost", "::1"])("allows it on %s", (host) => {
    expect(openRefusal(host)).toBeUndefined();
  });

  it.each(["0.0.0.0", "192.168.1.20", "viewer.lan"])(
    "refuses it on %s, saying why",
    (host) => {
      expect(openRefusal(host)).toContain("--host");
    },
  );
});

// A real process, because only one shows the two outcomes the server reports differently: a program
// that started (whatever it does next is the reader's), and one that does not exist.
describe("launchDetached", () => {
  it("resolves once the program has started", async () => {
    await expect(
      launchDetached({ command: process.execPath, args: ["-e", ""] }),
    ).resolves.toBeUndefined();
  });

  it("rejects when there is no such program", async () => {
    await expect(
      launchDetached({
        command: "wastech-mdlint-viewer-no-such-program",
        args: [],
      }),
    ).rejects.toThrow();
  });

  // The viewer usually runs in the repository it serves. Started by bare name, a program is looked
  // up there before `PATH` on Windows (and through a `.` entry of `PATH` elsewhere), so an
  // `explorer.exe` committed to a cloned repository would be what "Show in folder" runs. The probe
  // is a program of that kind placed in the working directory: the control proves a bare-name start
  // would really run it, and `launchDetached` must not.
  it("never runs a program placed in the working directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-open-"));
    const name = "wastech-viewer-probe";
    const marker = path.join(dir, "ran");
    const previousDir = process.cwd();
    const previousPath = process.env.PATH;
    // Windows reads this from the *parent's* environment when it looks a program up; almost no
    // machine sets it, though some tool harnesses do. It is removed so the control shows the lookup
    // an ordinary machine does, and so it cannot be what keeps the probe from running.
    const variable = Object.keys(process.env).filter(
      (key) => key.toUpperCase() === "NODEFAULTCURRENTDIRECTORYINEXEPATH",
    );
    const saved = variable.map((key) => [key, process.env[key]] as const);
    try {
      if (process.platform === "win32") {
        // Node stands in for the program: any Windows executable will do.
        await copyFile(process.execPath, path.join(dir, `${name}.exe`));
      } else {
        await writeFile(
          path.join(dir, name),
          `#!/bin/sh\ntouch '${marker}'\n`,
          "utf8",
        );
        await chmod(path.join(dir, name), 0o755);
        process.env.PATH = [".", previousPath ?? ""].join(path.delimiter);
      }
      for (const key of variable) {
        Reflect.deleteProperty(process.env, key);
      }
      process.chdir(dir);

      const script = `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`;
      const args = process.platform === "win32" ? ["-e", script] : [];
      const control = spawnSync(name, args, { windowsHide: true });
      expect(control.error).toBeUndefined();
      expect(existsSync(marker)).toBe(true);
      await rm(marker);

      await expect(launchDetached({ command: name, args })).rejects.toThrow(
        "not found on PATH",
      );
      expect(existsSync(marker)).toBe(false);
    } finally {
      process.chdir(previousDir);
      // Assigning `undefined` would store the string "undefined", so an unset `PATH` stays unset.
      if (previousPath === undefined) {
        Reflect.deleteProperty(process.env, "PATH");
      } else {
        process.env.PATH = previousPath;
      }
      for (const [key, value] of saved) {
        process.env[key] = value;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
