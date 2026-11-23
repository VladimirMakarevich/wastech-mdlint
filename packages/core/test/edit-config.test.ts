import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "../src/config/config-error.js";
import { editConfigText } from "../src/config/edit-config.js";
import {
  loadConfiguration,
  parseConfiguration,
} from "../src/config/load-config.js";

const commented = `{
  // Why these files: the agent context is what this linter is for.
  "include": ["docs/**/*.md"],
  "rules": [
    // Broken links fail the build.
    { "rule": "REF-001" },
    { "rule": "SIZE-001", "options": { "bytes": { "warn": 1000 } } } // budget agreed with the team
  ]
}
`;

describe("editConfigText", () => {
  it("changes one value and keeps every comment around it", () => {
    const edited = editConfigText(commented, [
      { op: "set", path: ["rules", 0, "severity"], value: "warning" },
    ]);
    expect(edited).toContain(
      "// Why these files: the agent context is what this linter is for.",
    );
    expect(edited).toContain("// Broken links fail the build.");
    expect(edited).toContain("// budget agreed with the team");
    // The object the edit lands in is laid out again; its neighbors are left as they were written.
    expect(edited).toContain(
      '{\n      "rule": "REF-001",\n      "severity": "warning"\n    },',
    );
    expect(edited).toContain(
      '{ "rule": "SIZE-001", "options": { "bytes": { "warn": 1000 } } } // budget',
    );
  });

  it("appends a rule in the file's own indentation and removes another", () => {
    const fourSpaces = commented.replace(/^( +)/gm, (indent) =>
      indent.replace(/ {2}/g, "    "),
    );
    const edited = editConfigText(fourSpaces, [
      { op: "insert", path: ["rules", 2], value: { rule: "GRP-001" } },
      { op: "remove", path: ["rules", 0] },
    ]);
    expect(JSON.parse(edited.replace(/\/\/.*$/gm, "")).rules).toEqual([
      { rule: "SIZE-001", options: { bytes: { warn: 1000 } } },
      { rule: "GRP-001" },
    ]);
    expect(edited).toMatch(/\n {8}\{\n {12}"rule": "GRP-001"\n {8}\}/);
  });

  // Each edit is applied to the text the one before it produced, so the second path already sees
  // the first rule gone.
  it("applies edits in order, each against the result of the one before", () => {
    const edited = editConfigText(commented, [
      { op: "remove", path: ["rules", 0] },
      { op: "set", path: ["rules", 0, "severity"], value: "error" },
    ]);
    expect(JSON.parse(edited.replace(/\/\/.*$/gm, "")).rules).toEqual([
      {
        rule: "SIZE-001",
        severity: "error",
        options: { bytes: { warn: 1000 } },
      },
    ]);
  });

  it("creates the objects above a new value when they are missing", () => {
    const edited = editConfigText(commented, [
      { op: "set", path: ["settings", "siteRouter", "preset"], value: "x" },
    ]);
    expect(JSON.parse(edited.replace(/\/\/.*$/gm, "")).settings).toEqual({
      siteRouter: { preset: "x" },
    });
  });

  // The config's newline comes from its own bytes, never from the platform the edit runs on.
  it("keeps a CRLF file CRLF and a tab-indented file tab-indented", () => {
    const crlf = editConfigText(commented.replace(/\n/g, "\r\n"), [
      { op: "insert", path: ["rules", 0], value: { rule: "GRP-001" } },
    ]);
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");

    const tabs = editConfigText(commented.replace(/^ {2}/gm, "\t"), [
      { op: "set", path: ["exclude"], value: ["a/**", "b/**"] },
    ]);
    expect(tabs).toContain('\t"exclude": [\n\t\t"a/**",\n\t\t"b/**"\n\t]');
  });

  it("gives the same bytes for the same text and edits", () => {
    const edits = [
      { op: "set" as const, path: ["respectGitignore"], value: false },
      { op: "insert" as const, path: ["rules", 1], value: { rule: "GRP-002" } },
    ];
    expect(editConfigText(commented, edits)).toBe(
      editConfigText(commented, edits),
    );
  });

  it.each([
    [
      { op: "set" as const, path: [], value: {} },
      "an edit needs a path below the root",
    ],
    [
      { op: "insert" as const, path: ["rules"], value: {} },
      "an insert needs a path that ends in an array index",
    ],
    [
      { op: "remove" as const, path: ["rules", -1] },
      "an array index must be a whole number of zero or more",
    ],
    [
      { op: "set" as const, path: ["include"], value: undefined },
      "a set or insert needs a value",
    ],
  ])("refuses a malformed edit: %j", (edit, message) => {
    expect(() => editConfigText(commented, [edit])).toThrow(message);
  });

  it("names the edit that runs a path through the wrong kind of value", () => {
    let error: unknown;
    try {
      editConfigText(commented, [
        { op: "set", path: ["include", "x"], value: 1 },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toMatch(
      /^Cannot apply config edit 1:\n- config\.include\.x: /,
    );
  });

  it("refuses to edit text that is not valid JSONC", () => {
    expect(() =>
      editConfigText('{ "rules": [ { "rule": "REF-001" ', [
        { op: "set", path: ["include"], value: [] },
      ]),
    ).toThrow(/^Cannot edit config text that is not valid JSONC: /);
  });
});

describe("parseConfiguration", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("resolves the rules of config text that is not on disk", () => {
    const loaded = parseConfiguration({
      text: commented,
      cwd: os.tmpdir(),
      configPath: path.join(os.tmpdir(), "wastech-mdlint.config.json"),
    });
    expect(loaded.rules.map(({ rule }) => rule.id)).toEqual([
      "REF-001",
      "SIZE-001",
    ]);
    expect(loaded.config.include).toEqual(["docs/**/*.md"]);
  });

  // A host that checks a candidate here must be told exactly what loading that file would tell it.
  it.each([
    ['{ "rules": [ { "rule": "REF-01" } ] }'],
    ['{ "rules": [ { "rule": "SIZE-001", "options": { "bytes": 5 } } ] }'],
    ['{ "includes": [] }'],
    ['{ "rules": [ '],
  ])("refuses %s with the message loading it gives", async (text) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wastech-parse-config-"));
    tempDirs.push(root);
    const configPath = path.join(root, "wastech-mdlint.config.json");
    await writeFile(configPath, text, "utf8");
    const loading = await loadConfiguration({ cwd: root }).catch(
      (error: unknown) => error,
    );
    expect(loading).toBeInstanceOf(ConfigError);
    expect(() => parseConfiguration({ text, cwd: root, configPath })).toThrow(
      (loading as ConfigError).message,
    );
    expect((loading as ConfigError).message).toContain(
      "wastech-mdlint.config.json",
    );
    expect((loading as ConfigError).message).not.toContain(root);
  });
});
