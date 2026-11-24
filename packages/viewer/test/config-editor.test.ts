import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import { parseCliArgs } from "../src/cli-args.js";
import { CONFIG_DATA_ID as CLIENT_CONFIG_DATA_ID } from "../src/client/config-editor.js";
import {
  CONFIG_DATA_ID,
  CONFIG_READ_ONLY,
  hashText,
  saveCandidate,
} from "../src/config-editor.js";
import { openCommand, type LaunchCommand } from "../src/open-file.js";
import { CHANGES_OFF_REMOTELY } from "../src/security.js";
import { startViewer, type RunningViewer } from "../src/server.js";

assertBuilt(
  fileURLToPath(new URL("../dist/client/viewer.js", import.meta.url)),
  fileURLToPath(new URL("../src/client/viewer.ts", import.meta.url)),
);

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url));

// The fixture's config with comments added, because keeping them through a save is the point of
// editing the text in place.
const COMMENTED_CONFIG = `{
  // Every Markdown file in the fixture.
  "include": ["**/*.md"],
  "rules": [
    // Broken links and anchors are what the fixture exercises.
    { "rule": "REF-001" },
    { "rule": "REF-002" } // anchors too
  ]
}
`;

type Response = { status: number; headers: IncomingHttpHeaders; body: string };

type Viewer = {
  dir: string;
  viewer: RunningViewer;
  port: number;
  token: string;
  // Every program the viewer was asked to start, in place of starting it, so a test run never opens
  // a window; `failLaunch` makes the next start fail as a missing program would.
  launched: LaunchCommand[];
  failLaunch: boolean;
};

async function start(allowConfigWrites: boolean): Promise<Viewer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-config-"));
  await cp(fixtureRoot, dir, { recursive: true });
  await writeFile(
    path.join(dir, "wastech-mdlint.config.json"),
    COMMENTED_CONFIG,
    "utf8",
  );
  const launched: LaunchCommand[] = [];
  const state = { failLaunch: false };
  const viewer = await startViewer({
    cwd: dir,
    host: "127.0.0.1",
    port: 0,
    portExplicit: true,
    // Off, so a save in one test does not reload the corpus under the next one; a save then reloads
    // the corpus itself, which is the path that has nothing else to rely on.
    watch: false,
    allowConfigWrites,
    launch: (command) => {
      if (state.failLaunch) {
        state.failLaunch = false;
        return Promise.reject(new Error("spawn ENOENT"));
      }
      launched.push(command);
      return Promise.resolve();
    },
  });
  const port = Number(new URL(viewer.url).port);
  const page = await send(port, "/config");
  const token =
    /<meta name="wastech-change-token" content="([0-9a-f]{64})">/.exec(
      page.body,
    )?.[1];
  if (token === undefined) {
    throw new Error("the config page carries no change token");
  }
  return {
    dir,
    viewer,
    port,
    token,
    launched,
    get failLaunch() {
      return state.failLaunch;
    },
    set failLaunch(value: boolean) {
      state.failLaunch = value;
    },
  };
}

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
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

// A change request exactly as the config page's script sends one.
function change(
  target: Viewer,
  route: "preview" | "save" | "open",
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return send(target.port, `/api/config/${route}`, {
    method: "POST",
    headers: {
      Origin: `http://127.0.0.1:${target.port}`,
      "Content-Type": "application/json",
      "X-Wastech-Viewer-Token": target.token,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function currentHash(target: Viewer): Promise<string> {
  return hashText(
    await readFile(path.join(target.dir, "wastech-mdlint.config.json"), "utf8"),
  );
}

let writable: Viewer;
let readOnly: Viewer;

beforeAll(async () => {
  [writable, readOnly] = await Promise.all([start(true), start(false)]);
}, 30_000);

afterAll(async () => {
  for (const target of [writable, readOnly]) {
    if (target !== undefined) {
      await target.viewer.close();
      await rm(target.dir, { recursive: true, force: true });
    }
  }
});

// Showing the config in the file manager, or opening it in its default application, starts a program
// on the machine running the viewer — so the request is held to every check a save is, may only pick
// one of the two actions, and always applies to the config the corpus was loaded from.
describe("opening the config", () => {
  it("offers both actions on the config page of a loopback viewer", async () => {
    const { body } = await send(readOnly.port, "/config");
    expect(body).toContain(
      '<p class="config-open" hidden><button class="config-open-button" type="button" data-open="reveal">Show in folder</button><button class="config-open-button" type="button" data-open="open">Open in default app</button>',
    );
  });

  it.each(["reveal", "open"] as const)(
    "starts the system's program to %s the config file, with no write flag needed",
    async (action) => {
      const before = readOnly.launched.length;
      const response = await change(readOnly, "open", { action });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: "opened", action });
      expect(readOnly.launched.slice(before)).toEqual([
        openCommand(
          process.platform,
          action,
          path.join(readOnly.dir, "wastech-mdlint.config.json"),
        ),
      ]);
    },
  );

  it("refuses a request without the page's token, and starts nothing", async () => {
    const before = readOnly.launched.length;
    const response = await change(
      readOnly,
      "open",
      { action: "open" },
      { "X-Wastech-Viewer-Token": "0".repeat(64) },
    );
    expect(response.status).toBe(403);
    const foreign = await change(
      readOnly,
      "open",
      { action: "open" },
      { Origin: "http://attacker.example" },
    );
    expect(foreign.status).toBe(403);
    expect(readOnly.launched.length).toBe(before);
  });

  it("takes only a POST, and only one of the two actions", async () => {
    const before = readOnly.launched.length;
    expect((await send(readOnly.port, "/api/config/open")).status).toBe(405);
    for (const body of [{ action: "delete" }, { action: ["open"] }, {}, null]) {
      const response = await change(readOnly, "open", body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(readOnly.launched.length).toBe(before);
  });

  // A program that cannot be started is a failure the reader must hear about, not a silent success.
  it("reports a program that could not be started", async () => {
    readOnly.failLaunch = true;
    const response = await change(readOnly, "open", { action: "reveal" });
    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("spawn ENOENT") as unknown,
    });
  });
});

describe("config page", () => {
  it("shows the file, the registry's rules and whether saving is on", async () => {
    const { status, body } = await send(readOnly.port, "/config");
    expect(status).toBe(200);
    expect(body).toContain(
      '<p class="config-file">Config file: <code>wastech-mdlint.config.json</code> <button class="copy-path"',
    );
    expect(body).toContain(
      "Saving is off. Start the viewer with --allow-config-writes",
    );
    expect(body).toContain(
      '<section class="config-current" aria-label="Current file">',
    );
    expect(body).toMatch(
      /<td><a href="[^"]+SIZE-001[^"]*"[^>]*><code>SIZE-001<\/code><\/a><\/td>/,
    );
    expect((await send(writable.port, "/config")).body).toContain(
      "Saving is on: a saved change is written to this file.",
    );
  });

  it("links the header to the config page", async () => {
    expect((await send(readOnly.port, "/doc/README.md")).body).toContain(
      '<a class="segment" href="/config">Config</a>',
    );
  });

  // Asked for as the page opened, the editor's data arrived a frame or two after the page was drawn,
  // and the form then pushed the file below it down the page. The page carries it instead, the very
  // answer `/api/config` gives, under the id the page script reads.
  it("carries the editor's data in the page, the same as /api/config", async () => {
    const page = (await send(readOnly.port, "/config")).body;
    const carried =
      /<script type="application\/json" id="viewer\.config-data">([\s\S]*?)<\/script>/.exec(
        page,
      )?.[1];
    expect(carried).toBeDefined();
    expect(JSON.parse(carried ?? "")).toEqual(
      JSON.parse((await send(readOnly.port, "/api/config")).body),
    );
    expect(CLIENT_CONFIG_DATA_ID).toBe(CONFIG_DATA_ID);
    // The page is not drawn before its script has built the editor, which goes above the file; a
    // document's page does not wait for its script.
    expect(page).toContain(
      '<script type="module" src="/assets/viewer.js" blocking="render">',
    );
    expect((await send(readOnly.port, "/doc/README.md")).body).toContain(
      '<script type="module" src="/assets/viewer.js"></script>',
    );
  });

  // The data holds the config file's own text, which ends the `<script>` element at the first
  // `</script` it contains and could open a comment with `<!--`. Every `<` in it is escaped, so the
  // element ends where the page ends it and the text reads back as written.
  it("keeps a config's own text from ending the data it is carried in", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-script-"));
    await cp(fixtureRoot, dir, { recursive: true });
    const hostile = `{\n  // </script><script>alert(1)</script> <!-- here\n  "include": ["**/*.md"]\n}\n`;
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      hostile,
      "utf8",
    );
    const viewer = await startViewer({
      cwd: dir,
      host: "127.0.0.1",
      port: 0,
      portExplicit: true,
      watch: false,
    });
    try {
      const page = (await send(Number(new URL(viewer.url).port), "/config"))
        .body;
      expect(page).not.toContain("</script><script>alert(1)");
      expect(page).not.toContain("<!-- here");
      const carried =
        /<script type="application\/json" id="viewer\.config-data">([\s\S]*?)<\/script>/.exec(
          page,
        )?.[1] ?? "";
      expect(carried).not.toContain("<");
      expect(
        (JSON.parse(carried) as { file: { text: string } }).file.text,
      ).toBe(hostile);
    } finally {
      await viewer.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gives the page script the file, the schema and the registry", async () => {
    const data = JSON.parse(
      (await send(readOnly.port, "/api/config")).body,
    ) as {
      file: { path: string; text: string; hash: string };
      config: { rules: { rule: string }[] };
      ruleIds: (string | null)[];
      writeBlocked: string | null;
      schema: { properties: { rules: unknown } };
      rules: { id: string; description: string }[];
    };
    expect(data.file).toEqual({
      path: "wastech-mdlint.config.json",
      text: COMMENTED_CONFIG,
      hash: hashText(COMMENTED_CONFIG),
    });
    expect(data.ruleIds).toEqual(["REF-001", "REF-002"]);
    expect(data.writeBlocked).toMatch(/^Saving is off\./);
    expect(data.schema.properties.rules).toBeDefined();
    expect(data.rules.map((rule) => rule.id)).toContain("SIZE-001");
    expect(
      (
        JSON.parse((await send(writable.port, "/api/config")).body) as {
          writeBlocked: string | null;
        }
      ).writeBlocked,
    ).toBeNull();
  });
});

describe("change requests are refused unless they come from the config page", () => {
  // Well formed, so whatever refuses it is the check under test, not the body.
  const preview = { base: hashText(COMMENTED_CONFIG), edits: [] };

  it("refuses a request without an Origin, as no page of ours sends one", async () => {
    const response = await change(readOnly, "preview", preview, {
      Origin: "",
    });
    expect(response.status).toBe(403);
  });

  it("refuses another site's origin", async () => {
    const response = await change(readOnly, "preview", preview, {
      Origin: "http://evil.example",
    });
    expect(response.status).toBe(403);
  });

  it("refuses fetch metadata that says the request is not same-origin", async () => {
    const response = await change(readOnly, "preview", preview, {
      "Sec-Fetch-Site": "same-site",
    });
    expect(response.status).toBe(403);
  });

  // A form post from another page can only send form or text types; JSON needs a preflight.
  it("refuses a body not declared as JSON", async () => {
    const response = await change(readOnly, "preview", preview, {
      "Content-Type": "text/plain",
    });
    expect(response.status).toBe(415);
  });

  it("refuses a missing or wrong token", async () => {
    expect(
      (
        await change(readOnly, "preview", preview, {
          "X-Wastech-Viewer-Token": "",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await change(readOnly, "preview", preview, {
          "X-Wastech-Viewer-Token": "0".repeat(64),
        })
      ).status,
    ).toBe(403);
    // Each viewer has its own token, so one viewer's page cannot drive another.
    expect(
      (
        await change(readOnly, "preview", preview, {
          "X-Wastech-Viewer-Token": writable.token,
        })
      ).status,
    ).toBe(403);
  });

  it("takes a change as a POST only, and no body anywhere else", async () => {
    const get = await send(readOnly.port, "/api/config/preview");
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
    const put = await send(readOnly.port, "/doc/README.md", { method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe("GET, HEAD");
    const post = await send(readOnly.port, "/api/config", {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${readOnly.port}`,
        "Content-Type": "application/json",
        "X-Wastech-Viewer-Token": readOnly.token,
      },
      body: "{}",
    });
    expect(post.status).toBe(405);
  });

  it.each([
    ["not JSON", "{", 400, "The request body is not valid JSON."],
    ["a list", "[]", 400, "The request body must be a JSON object."],
    [
      "an unknown field",
      JSON.stringify({ base: "0".repeat(64), script: "x" }),
      400,
      'Unknown field "script".',
    ],
    [
      "no base",
      JSON.stringify({ edits: [] }),
      400,
      '"base" must name the version of the file the change was made to.',
    ],
    [
      "an edit of an unknown kind",
      JSON.stringify({
        base: "0".repeat(64),
        edits: [{ op: "eval", path: [] }],
      }),
      400,
      'Edit 1 must have an "op" of set, remove or insert and a "path" of names and indexes.',
    ],
  ])("refuses a body that is %s", async (_name, body, status, error) => {
    const response = await change(readOnly, "preview", body);
    expect(response.status).toBe(status);
    expect(JSON.parse(response.body)).toEqual({ status: "refused", error });
  });

  it("refuses a body too large to be a config change", async () => {
    const response = await change(readOnly, "preview", {
      base: hashText(COMMENTED_CONFIG),
      text: "x".repeat(300 * 1024),
    });
    expect(response.status).toBe(413);
  });
});

type PreviewPayload = {
  status: string;
  text?: string;
  errors?: string[];
  error?: string;
  findings?: {
    before: { errors: number; warnings: number };
    after: { errors: number; warnings: number };
  };
  byRule?: { ruleId: string; before: number; after: number }[];
  added?: { filePath: string; ruleId: string }[];
  removed?: { filePath: string; ruleId: string }[];
  addedCount?: number;
  removedCount?: number;
};

describe("preview", () => {
  it("lints the candidate and says which findings it adds and removes", async () => {
    const response = await change(readOnly, "preview", {
      base: await currentHash(readOnly),
      edits: [
        { op: "remove", path: ["rules", 0] },
        {
          op: "insert",
          path: ["rules", 1],
          value: { rule: "SIZE-001", options: { bytes: { warn: 10 } } },
        },
      ],
    });
    expect(response.status).toBe(200);
    const preview = JSON.parse(response.body) as PreviewPayload;
    expect(preview.status).toBe("ok");
    // The fixture's one finding is REF-001's broken link, which goes with the rule; every document
    // is over a 10-byte budget.
    expect(preview.removed).toEqual([
      expect.objectContaining({ filePath: "README.md", ruleId: "REF-001" }),
    ]);
    expect(preview.addedCount).toBe(4);
    expect(preview.byRule).toEqual([
      { ruleId: "REF-001", before: 1, after: 0 },
      { ruleId: "SIZE-001", before: 0, after: 4 },
    ]);
    expect(preview.findings).toEqual({
      before: { errors: 1, warnings: 0 },
      after: { errors: 0, warnings: 4 },
    });
    // The comments around the edits survive into the text a save would write.
    expect(preview.text).toContain("// Every Markdown file in the fixture.");
    expect(preview.text).toContain("// anchors too");
  });

  it("refuses an unknown rule with core's message", async () => {
    const response = await change(readOnly, "preview", {
      base: await currentHash(readOnly),
      edits: [{ op: "insert", path: ["rules", 2], value: { rule: "REF-01" } }],
    });
    expect(response.status).toBe(422);
    const preview = JSON.parse(response.body) as PreviewPayload;
    expect(preview.status).toBe("invalid");
    expect(preview.errors).toEqual([
      "Invalid config at wastech-mdlint.config.json:",
      expect.stringMatching(/^- config\.rules\[2\]: Unknown rule "REF-01"\./),
    ]);
  });

  it("refuses invalid rule options with core's message", async () => {
    const response = await change(readOnly, "preview", {
      base: await currentHash(readOnly),
      edits: [
        {
          op: "insert",
          path: ["rules", 2],
          value: { rule: "SIZE-001", options: { bytes: { warn: "big" } } },
        },
      ],
    });
    expect(response.status).toBe(422);
    expect((JSON.parse(response.body) as PreviewPayload).errors?.[1]).toMatch(
      /^- config\.rules\[2\]\.options\.bytes\.warn: /,
    );
  });

  it("refuses text that is not valid JSONC", async () => {
    const response = await change(readOnly, "preview", {
      base: await currentHash(readOnly),
      text: '{ "rules": [ { "rule": "REF-001" ',
    });
    expect(response.status).toBe(422);
    expect((JSON.parse(response.body) as PreviewPayload).errors?.[0]).toMatch(
      /^Failed to parse JSONC config at wastech-mdlint\.config\.json: /,
    );
  });

  it("refuses an edit that cannot be applied", async () => {
    const response = await change(readOnly, "preview", {
      base: await currentHash(readOnly),
      edits: [{ op: "set", path: ["include", "x"], value: 1 }],
    });
    expect(response.status).toBe(422);
    expect((JSON.parse(response.body) as PreviewPayload).errors?.[0]).toBe(
      "Cannot apply config edit 1:",
    );
  });

  it("refuses a change made to another version of the file", async () => {
    const response = await change(readOnly, "preview", {
      base: hashText("{}"),
      edits: [],
    });
    expect(response.status).toBe(409);
    expect((JSON.parse(response.body) as PreviewPayload).status).toBe(
      "conflict",
    );
  });
});

describe("save", () => {
  const configFile = (target: Viewer) =>
    path.join(target.dir, "wastech-mdlint.config.json");

  it("writes nothing unless the viewer was started to allow it", async () => {
    const response = await change(readOnly, "save", {
      base: await currentHash(readOnly),
      text: COMMENTED_CONFIG.replace('"REF-002"', '"SIZE-001"'),
    });
    expect(response.status).toBe(403);
    expect((JSON.parse(response.body) as PreviewPayload).error).toMatch(
      /^Saving is off\./,
    );
    expect(await readFile(configFile(readOnly), "utf8")).toBe(COMMENTED_CONFIG);
  });

  it("writes nothing from another origin, even when writes are allowed", async () => {
    const response = await change(
      writable,
      "save",
      { base: await currentHash(writable), text: "{}" },
      { Origin: "http://evil.example" },
    );
    expect(response.status).toBe(403);
    expect(await readFile(configFile(writable), "utf8")).toBe(COMMENTED_CONFIG);
  });

  it("refuses to write a config core does not accept", async () => {
    const response = await change(writable, "save", {
      base: await currentHash(writable),
      text: '{ "rules": [ { "rule": "NOPE-001" } ] }',
    });
    expect(response.status).toBe(422);
    expect(await readFile(configFile(writable), "utf8")).toBe(COMMENTED_CONFIG);
  });

  it("refuses edits: a save writes the previewed text and nothing else", async () => {
    const response = await change(writable, "save", {
      base: await currentHash(writable),
      edits: [{ op: "remove", path: ["rules", 0] }],
    });
    expect(response.status).toBe(400);
  });

  it("writes the previewed text, keeps its comments and reloads the corpus", async () => {
    const preview = JSON.parse(
      (
        await change(writable, "preview", {
          base: await currentHash(writable),
          edits: [
            { op: "set", path: ["rules", 0, "severity"], value: "warning" },
          ],
        })
      ).body,
    ) as PreviewPayload;
    expect(preview.status).toBe("ok");

    const response = await change(writable, "save", {
      base: await currentHash(writable),
      text: preview.text,
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "saved",
      hash: hashText(preview.text!),
    });
    const written = await readFile(configFile(writable), "utf8");
    expect(written).toBe(preview.text);
    expect(written).toContain(
      "// Broken links and anchors are what the fixture exercises.",
    );

    // The broken link is now reported as a warning, the severity the saved config gives REF-001.
    const diagnostics = JSON.parse(
      (await send(writable.port, "/api/diagnostics?path=README.md")).body,
    ) as { findings: { ruleId: string; severity: string }[] };
    expect(diagnostics.findings).toEqual([
      expect.objectContaining({ ruleId: "REF-001", severity: "warning" }),
    ]);
  });

  it("refuses to save over a version of the file the page did not see", async () => {
    const before = await readFile(configFile(writable), "utf8");
    const response = await change(writable, "save", {
      base: hashText(COMMENTED_CONFIG),
      text: COMMENTED_CONFIG,
    });
    expect(response.status).toBe(409);
    expect(await readFile(configFile(writable), "utf8")).toBe(before);
  });
});

describe("saveCandidate", () => {
  // @boundary-guard write-failure
  //
  // The viewer's one write path, failing partway: a directory in the config file's place lets the
  // atomic write stage its temp file beside it and then makes the rename fail on every platform
  // (POSIX EISDIR, Windows EPERM or EACCES). The save must say it failed, name no success, leave the
  // target as it was and leave no temp file in the repository. The server answers such an outcome
  // with a 500 and the same message; no test reaches that through HTTP, because nothing makes the
  // write fail after the server has read the file it is about to replace without also making that
  // read fail first.
  it("reports a failed write, claims nothing was saved and leaves no temp file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-save-"));
    try {
      const target = path.join(dir, "wastech-mdlint.config.json");
      await mkdir(target);
      const outcome = await saveCandidate({
        file: {
          absolutePath: target,
          displayPath: "wastech-mdlint.config.json",
          text: "{}",
          hash: hashText("{}"),
        },
        text: '{ "rules": [] }',
      });
      expect(outcome).toEqual({
        status: "failed",
        message: expect.stringMatching(
          /^The config could not be written \([A-Z]+\); the file on disk is unchanged\.$/,
        ),
      });
      expect((await stat(target)).isDirectory()).toBe(true);
      expect(await readdir(dir)).toEqual(["wastech-mdlint.config.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Another program — an editor's autosave — writing the config in the same moment as the save. What
  // is on disk after the viewer's rename was written after it, so it is the newest version and must
  // be left alone: writing back the text the page started from would throw that program's change
  // away to undo the reader's, and leave neither. `readBack` stands in for the other program by
  // returning its text, so the file holding the viewer's own text afterwards proves nothing was put
  // back over it.
  it("leaves another program's newer version in place and reports a conflict", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-save-"));
    try {
      const target = path.join(dir, "wastech-mdlint.config.json");
      await writeFile(target, "{}", "utf8");
      const outcome = await saveCandidate({
        file: {
          absolutePath: target,
          displayPath: "wastech-mdlint.config.json",
          text: "{}",
          hash: hashText("{}"),
        },
        text: '{ "rules": [] }',
        readBack: () => Promise.resolve('{ "rules": [{ "rule": "REF-001" }] }'),
      });
      expect(outcome).toEqual({
        status: "conflict",
        message: expect.stringMatching(/^Another program changed the config/),
      });
      expect(await readFile(target, "utf8")).toBe('{ "rules": [] }');
      expect(await readdir(dir)).toEqual(["wastech-mdlint.config.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("save with watching on", () => {
  // A config passed with `--config` may be called anything. With watching on — the default — the
  // watcher is what reloads the corpus after a save, so a name it filtered out would leave every page
  // on the old config's findings after the page said the change was saved.
  it("reloads the corpus after saving a config with another name", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-named-"));
    await cp(fixtureRoot, dir, { recursive: true });
    await rm(path.join(dir, "wastech-mdlint.config.json"));
    await writeFile(path.join(dir, "lint.jsonc"), COMMENTED_CONFIG, "utf8");
    const viewer = await startViewer({
      cwd: dir,
      configPath: "lint.jsonc",
      host: "127.0.0.1",
      port: 0,
      portExplicit: true,
      watch: true,
      allowConfigWrites: true,
    });
    try {
      const port = Number(new URL(viewer.url).port);
      const token =
        /<meta name="wastech-change-token" content="([0-9a-f]{64})">/.exec(
          (await send(port, "/config")).body,
        )![1]!;
      const target: Viewer = {
        dir,
        viewer,
        port,
        token,
        launched: [],
        failLaunch: false,
      };
      const base = hashText(COMMENTED_CONFIG);
      const preview = JSON.parse(
        (
          await change(target, "preview", {
            base,
            edits: [
              { op: "set", path: ["rules", 0, "severity"], value: "warning" },
            ],
          })
        ).body,
      ) as PreviewPayload;
      const reloaded = nextStructuralChange(port);
      await reloaded.ready;
      const saved = await change(target, "save", { base, text: preview.text });
      expect(saved.status).toBe(200);
      // Beside the temp file the atomic write renamed over it, which the watcher reports too.
      expect((await reloaded.event).paths).toContain("lint.jsonc");
      const diagnostics = JSON.parse(
        (await send(port, "/api/diagnostics?path=README.md")).body,
      ) as { findings: { ruleId: string; severity: string }[] };
      expect(diagnostics.findings).toEqual([
        expect.objectContaining({ ruleId: "REF-001", severity: "warning" }),
      ]);
    } finally {
      await viewer.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

// Resolves with the first structural `change` event; `ready` once the stream is open, so the test
// saves only after the subscription exists and cannot miss the event.
function nextStructuralChange(port: number): {
  ready: Promise<void>;
  event: Promise<{ paths: string[]; structural: boolean }>;
} {
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const event = new Promise<{ paths: string[]; structural: boolean }>(
    (resolve, reject) => {
      const outgoing = request(
        { host: "127.0.0.1", port, path: "/events" },
        (incoming) => {
          let buffer = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            buffer += chunk;
            markReady();
            for (const match of buffer.matchAll(
              /event: change\ndata: (.*)\n\n/g,
            )) {
              const payload = JSON.parse(match[1]!) as {
                paths: string[];
                structural: boolean;
              };
              if (payload.structural) {
                outgoing.destroy();
                resolve(payload);
              }
            }
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    },
  );
  return { ready, event };
}

// With `--host`, whoever reaches the port loads the same pages as the user. A token carried in the
// config page then proved nothing, and a preview linted the checkout under a config the request
// supplied: `include` widened past `.gitignore` and a custom rule whose finding quotes what it
// matched read `.env` back in the preview's findings. So off loopback the server takes no request
// with a body at all, checked before the token, and no page carries one.
describe("a viewer other machines can reach", () => {
  const SECRET = "API_KEY=do-not-serve";
  let remote: { dir: string; viewer: RunningViewer; port: number };
  const launched: LaunchCommand[] = [];

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-remote-"));
    await cp(fixtureRoot, dir, { recursive: true });
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      COMMENTED_CONFIG,
    );
    await writeFile(path.join(dir, ".gitignore"), ".env\n");
    await writeFile(path.join(dir, ".env"), `${SECRET}\n`);
    const viewer = await startViewer({
      cwd: dir,
      // The wildcard address is what a user passes to reach the viewer from another machine. The
      // requests below still arrive over loopback, as an IP literal the `Host` check accepts.
      host: "0.0.0.0",
      port: 0,
      portExplicit: true,
      watch: false,
      // Refused by the command line with a network address; set here anyway, so the test shows that
      // the binding alone keeps a save out, whatever the server was started with.
      allowConfigWrites: true,
      launch: (command) => {
        launched.push(command);
        return Promise.resolve();
      },
    });
    remote = { dir, viewer, port: Number(new URL(viewer.url).port) };
  }, 30_000);

  afterAll(async () => {
    await remote?.viewer.close();
    if (remote !== undefined) {
      await rm(remote.dir, { recursive: true, force: true });
    }
  });

  function post(route: string, body: unknown): Promise<Response> {
    return send(remote.port, route, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${remote.port}`,
        "Content-Type": "application/json",
        // Any token at all: there is none to match, and the binding is judged before it.
        "X-Wastech-Viewer-Token": "0".repeat(64),
      },
      body: JSON.stringify(body),
    });
  }

  it("refuses a preview, so no config sent from outside lints the checkout", async () => {
    const before = await readFile(
      path.join(remote.dir, "wastech-mdlint.config.json"),
      "utf8",
    );
    const response = await post("/api/config/preview", {
      base: hashText(before),
      text: JSON.stringify({
        include: ["**/*"],
        respectGitignore: false,
        rules: [
          {
            rule: "custom",
            id: "x",
            assert: { kind: "contentNotMatch", pattern: "[\\s\\S]{1,2000}" },
          },
        ],
      }),
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      status: "refused",
      error: CHANGES_OFF_REMOTELY,
    });
    expect(response.body).not.toContain(SECRET);
  });

  it("refuses a save, an open and a review mark the same way", async () => {
    const configPath = path.join(remote.dir, "wastech-mdlint.config.json");
    const before = await readFile(configPath, "utf8");
    for (const [route, body] of [
      ["/api/config/save", { base: hashText(before), text: "{}\n" }],
      ["/api/config/open", { action: "open" }],
      ["/api/review/mark", { path: "README.md" }],
    ] as const) {
      const response = await post(route, body);
      expect(response.status, route).toBe(403);
      expect(JSON.parse(response.body), route).toEqual({
        status: "refused",
        error: CHANGES_OFF_REMOTELY,
      });
    }
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(launched).toEqual([]);
  });

  it("serves the config page read-only, with no token and no editor", async () => {
    const { status, body } = await send(remote.port, "/config");
    expect(status).toBe(200);
    expect(body).not.toContain("wastech-change-token");
    expect(body).toContain(CONFIG_READ_ONLY);
    expect(body).not.toContain('class="config-editor"');
    expect(body).not.toContain(`id="${CONFIG_DATA_ID}"`);
    expect(body).not.toContain('class="config-open"');
    // What the page is for when it cannot edit: the file and the rules it runs.
    expect(body).toContain(
      '<section class="config-current" aria-label="Current file">',
    );
    for (const page of ["/doc/README.md", "/dashboard", "/graph"]) {
      expect((await send(remote.port, page)).body, page).not.toContain(
        "wastech-change-token",
      );
    }
  });
});

describe("--allow-config-writes", () => {
  it("is off by default and on when asked for", () => {
    expect(parseCliArgs([])).toMatchObject({ allowConfigWrites: false });
    expect(parseCliArgs(["--allow-config-writes"])).toMatchObject({
      allowConfigWrites: true,
    });
    expect(
      parseCliArgs(["--allow-config-writes", "--host", "localhost"]),
    ).toMatchObject({ kind: "run", allowConfigWrites: true });
  });

  // Anyone who can reach the port could save from the page, so the flag stays on this machine.
  it("is refused with a network address", () => {
    expect(
      parseCliArgs(["--allow-config-writes", "--host", "0.0.0.0"]),
    ).toEqual({
      kind: "error",
      message:
        "--allow-config-writes works only on a loopback address, not with --host 0.0.0.0: anyone who can reach the viewer could rewrite the config.",
    });
  });
});
