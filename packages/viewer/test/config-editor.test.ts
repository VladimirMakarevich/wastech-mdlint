import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import { parseCliArgs } from "../src/cli-args.js";
import { hashText, saveCandidate } from "../src/config-editor.js";
import { Corpus } from "../src/corpus.js";
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
};

async function start(allowConfigWrites: boolean): Promise<Viewer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-config-"));
  await cp(fixtureRoot, dir, { recursive: true });
  await writeFile(
    path.join(dir, "wastech-mdlint.config.json"),
    COMMENTED_CONFIG,
    "utf8",
  );
  const viewer = await startViewer({
    cwd: dir,
    host: "127.0.0.1",
    port: 0,
    portExplicit: true,
    // Off, so a save in one test does not reload the corpus under the next one; a save then reloads
    // the corpus itself, which is the path that has nothing else to rely on.
    watch: false,
    allowConfigWrites,
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
  return { dir, viewer, port, token };
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
  route: "preview" | "save",
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

describe("config page", () => {
  it("shows the file, the registry's rules and whether saving is on", async () => {
    const { status, body } = await send(readOnly.port, "/config");
    expect(status).toBe(200);
    expect(body).toContain(
      '<p class="config-file">Config file: <code>wastech-mdlint.config.json</code></p>',
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
      '<a class="topbar-link" href="/config">Config</a>',
    );
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
  // A write that fails must say so and leave the config as it was. The target's folder does not
  // exist, so the temp file the atomic write stages beside it cannot even be created.
  it("reports a failed write and claims nothing was saved", async () => {
    const corpus = await Corpus.load({ cwd: fixtureRoot });
    const missing = path.join(
      os.tmpdir(),
      "wastech-no-such-dir",
      "config.json",
    );
    const outcome = await saveCandidate({
      corpus,
      file: {
        absolutePath: missing,
        displayPath: "config.json",
        text: "{}",
        hash: hashText("{}"),
      },
      text: '{ "rules": [] }',
    });
    expect(outcome).toEqual({
      status: "failed",
      message:
        "The config could not be written (ENOENT); the file on disk is unchanged.",
    });
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
