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
  // Compared as whole text: every byte but the new property is the file as written, and the entry it
  // lands in stays on its one line.
  it("adds a property and changes nothing else", () => {
    expect(
      editConfigText(commented, [
        { op: "set", path: ["rules", 0, "severity"], value: "warning" },
      ]),
    ).toBe(
      commented.replace(
        '{ "rule": "REF-001" }',
        '{ "rule": "REF-001", "severity": "warning" }',
      ),
    );
  });

  it("replaces a value in place, keeping a one-line value on one line", () => {
    expect(
      editConfigText(commented, [
        {
          op: "set",
          path: ["rules", 1, "options", "bytes"],
          value: { warn: 2000, error: 4000 },
        },
      ]),
    ).toBe(
      commented.replace('{ "warn": 1000 }', '{"warn": 2000, "error": 4000}'),
    );
  });

  // The case jsonc-parser's `modify` gets wrong: its formatter re-lays-out the line the insertion
  // starts on, which is the last rule's. The new entry is one line, like the entry before it.
  it("appends after a commented last element without moving its comment or its layout", () => {
    expect(
      editConfigText(commented, [
        { op: "insert", path: ["rules", 2], value: { rule: "GRP-001" } },
      ]),
    ).toBe(
      commented.replace(
        "} // budget agreed with the team\n",
        '}, // budget agreed with the team\n    {"rule": "GRP-001"}\n',
      ),
    );
  });

  it("spreads a new element over lines when the one before it is", () => {
    const spread = `{
    "rules": [
        {
            "rule": "REF-001"
        }
    ]
}
`;
    expect(
      editConfigText(spread, [
        {
          op: "insert",
          path: ["rules", 1],
          value: { rule: "SIZE-001", options: { lines: { warn: 400 } } },
        },
      ]),
    ).toBe(`{
    "rules": [
        {
            "rule": "REF-001"
        },
        {
            "rule": "SIZE-001",
            "options": {
                "lines": {
                    "warn": 400
                }
            }
        }
    ]
}
`);
  });

  // The other case `modify` gets wrong: removing the last element took the comment trailing the one
  // before it along with the comma.
  it("removes the last element and keeps the comment of the one before", () => {
    const twoRules = `{
  "rules": [
    { "rule": "REF-001" }, // the one that stays
    { "rule": "GRP-001" } // the one that goes
  ]
}
`;
    expect(editConfigText(twoRules, [{ op: "remove", path: ["rules", 1] }]))
      .toBe(`{
  "rules": [
    { "rule": "REF-001" } // the one that stays
  ]
}
`);
  });

  // A comment above a removed element may describe the ones after it too, so it is kept; a comment
  // on the element's own line goes with it.
  it("removes an element's own lines and keeps the comment above it", () => {
    expect(
      editConfigText(commented, [{ op: "remove", path: ["rules", 0] }]),
    ).toBe(commented.replace('    { "rule": "REF-001" },\n', ""));
  });

  it("joins a list written on one line, and leaves it on one line", () => {
    const appended = editConfigText(commented, [
      { op: "insert", path: ["include", 1], value: "notes/**/*.md" },
    ]);
    expect(appended).toContain('"include": ["docs/**/*.md", "notes/**/*.md"],');
    expect(
      editConfigText(appended, [{ op: "remove", path: ["include", 0] }]),
    ).toContain('"include": ["notes/**/*.md"],');
    expect(
      editConfigText(commented, [
        { op: "insert", path: ["include", 0], value: "a.md" },
      ]),
    ).toContain('"include": ["a.md", "docs/**/*.md"],');
  });

  it("gives an element inserted into a list written one per line a line of its own", () => {
    expect(
      editConfigText(commented, [
        { op: "insert", path: ["rules", 1], value: { rule: "GRP-001" } },
      ]),
    ).toBe(
      commented.replace(
        '    { "rule": "SIZE-001"',
        '    {"rule": "GRP-001"},\n    { "rule": "SIZE-001"',
      ),
    );
  });

  it("fills an empty list, keeping a comment inside it", () => {
    expect(
      editConfigText('{\n  "rules": [ // none yet\n  ]\n}\n', [
        { op: "insert", path: ["rules", 0], value: { rule: "REF-001" } },
      ]),
    ).toBe(
      '{\n  "rules": [ // none yet\n    {\n      "rule": "REF-001"\n    }\n  ]\n}\n',
    );
    expect(
      editConfigText('{\n  "rules": []\n}\n', [
        { op: "insert", path: ["rules", 0], value: { rule: "REF-001" } },
      ]),
    ).toBe('{\n  "rules": [\n    {\n      "rule": "REF-001"\n    }\n  ]\n}\n');
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
    expect(edited).toContain('\n        {"rule": "GRP-001"}\n    ]');
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

  it.each([
    [
      { op: "insert" as const, path: ["rules", 5], value: {} },
      "the list has 2 elements, so nothing can go before element 5",
    ],
    [
      { op: "set" as const, path: ["rules", 3], value: {} },
      "the list has 2 elements, so there is no element 3 to set",
    ],
    [
      { op: "set" as const, path: ["rules", "first"], value: {} },
      "a name cannot pick an element of a list",
    ],
    [
      { op: "set" as const, path: ["compile", 1], value: {} },
      "a list that does not exist yet has no element 1",
    ],
    [
      { op: "insert" as const, path: ["include", 0, 0], value: "x" },
      "an insert needs a list to insert into",
    ],
  ])("refuses an edit its path cannot reach: %j", (edit, message) => {
    expect(() => editConfigText(commented, [edit])).toThrow(message);
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
