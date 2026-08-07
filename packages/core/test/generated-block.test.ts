import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { replaceGeneratedBlock } from "../../../scripts/generated-block.mjs";

// `scripts/generate-docs.mjs` spliced generated tables into the README through
// `String.prototype.replace` with an *interpolated replacement string*, where `$` is a
// metacharacter. The templates' own `$1`/`$2` back-references were deliberate, so a `$&` or `` $` ``
// in any rule or MCP tool description would have expanded silently: the README would have gained a
// second copy of its own content (or lost the END marker into the middle of a table), and the only
// thing that would have complained is a docs-sync byte compare in another package.
//
// The payload happened to be inert, so the behavioral cases below are what stops it going back to
// being *assumed* inert. The source-text case is what stops the next call site reintroducing the
// class, which no behavioral test over today's call sites can see.
//
// Lives in `core`'s suite while reading `scripts/` for the same reason `docs-sync.test.ts` reads the
// repo-root README from here: this is a repo-wide guard and `core` is where those live.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const RULE_MARKERS =
  /(<!-- BEGIN GENERATED RULES -->)[\s\S]*?(<!-- END GENERATED RULES -->)/;

const DOCUMENT = [
  "# Rules",
  "",
  "<!-- BEGIN GENERATED RULES -->",
  "stale content",
  "<!-- END GENERATED RULES -->",
  "",
  "Trailing prose.",
].join("\n");

describe("replaceGeneratedBlock", () => {
  it("emits the wrapper shape the docs-sync extraction regexes key on", () => {
    // The regression guard for the refactor itself: this pattern is copied from
    // `docs-sync.test.ts` / `packages/mcp-server/test/docs-sync.test.ts`, both of which compare the
    // captured group byte-for-byte against the generator's raw output. If the helper's scaffolding
    // drifts by one newline, those two fail on a README diff far from here; this fails on the shape.
    const updated = replaceGeneratedBlock(DOCUMENT, RULE_MARKERS, "| a | b |");

    const match =
      /<!-- BEGIN GENERATED RULES -->\n<!-- prettier-ignore -->\n([\s\S]*?)\n\n<!-- END GENERATED RULES -->/.exec(
        updated,
      );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("| a | b |");
    expect(updated).toContain("Trailing prose.");
  });

  it("writes every `$` sequence in the content literally", () => {
    // One row per replacement-string metacharacter: `$&` (whole match), `` $` `` (prefix), `$'`
    // (suffix), `$1` (a real group in this pattern — the BEGIN marker), and `$$` (an escaped
    // dollar). Under the old interpolated form each of these expanded; `$&` alone would have
    // inlined the entire matched block, END marker included.
    const content = [
      "| `RULE-001` | Warns on $& in a heading |",
      "| `RULE-002` | Warns on $` and $' |",
      "| `RULE-003` | Warns on $1 and $$ |",
    ].join("\n");

    const updated = replaceGeneratedBlock(DOCUMENT, RULE_MARKERS, content);

    expect(updated).toContain(content);
    // An expansion of `$&` or `$1` would splice a copy of the BEGIN marker into the block, so
    // counting the markers catches it even where the literal text survived somewhere in the result.
    expect(updated.split("<!-- BEGIN GENERATED RULES -->")).toHaveLength(2);
    expect(updated.split("<!-- END GENERATED RULES -->")).toHaveLength(2);
    expect(updated.indexOf("RULE-003")).toBeLessThan(
      updated.indexOf("<!-- END GENERATED RULES -->"),
    );
  });

  it("throws when the marker pair is absent instead of silently writing the document back", () => {
    // A no-op splice used to surface only as a stale-docs failure in another package's suite. The
    // throw puts the failure at the call that could not find its markers.
    expect(() =>
      replaceGeneratedBlock("# Rules\n\nNo markers here.\n", RULE_MARKERS, "x"),
    ).toThrow(/generated-block markers/);
  });
});

describe("generate-docs.mjs splice sites", () => {
  // Reading the script text follows the `release:check` precedent in `package-payload.test.ts`: a
  // behavioral test over the two current call sites stays green when a *third* one is added with an
  // interpolated replacement string, and that third one is the whole risk this task closes.
  const source = readFileSync(
    path.join(repoRoot, "scripts", "generate-docs.mjs"),
    "utf8",
  );

  it("routes both splices through the helper", () => {
    expect(source.match(/replaceGeneratedBlock\(/g)).toHaveLength(2);
  });

  it("calls no String.prototype.replace of its own", () => {
    expect(
      source.includes(".replace("),
      "scripts/generate-docs.mjs must not call .replace() directly: generated content used as a " +
        "replacement string expands `$&`, `` $` ``, `$'` and `$n` (W-55). Splice through " +
        "replaceGeneratedBlock(), or — for a replace that has nothing to do with generated content " +
        "— pass a replacer function and relax this guard deliberately.",
    ).toBe(false);
  });
});
