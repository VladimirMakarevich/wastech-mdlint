import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseStaticSkill } from "../src/skills/parse-static-skill.js";

// Resolve the committed `skills/` tree relative to this test file (repo root is three levels up from
// packages/core/test), the same anchoring the README docs-sync check uses.
const skillsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../skills",
);

// Enumerate on disk rather than hard-coding a list so a future skill is covered automatically; sort so
// iteration order is deterministic regardless of filesystem readdir order.
const skillIds = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function readSkill(id: string): string {
  return readFileSync(path.join(skillsDir, id, "SKILL.md"), "utf8");
}

describe("shipped skills", () => {
  it("ships exactly the three skills the release tags", () => {
    expect(skillIds).toEqual([
      "wastech-mdlint-fix",
      "wastech-mdlint-impact",
      "wastech-mdlint-init",
    ]);
  });

  // Every static skill's frontmatter validates against the one shared schema.
  it.each(skillIds)("validates %s frontmatter against the schema", (id) => {
    const result = parseStaticSkill(readSkill(id), `skills/${id}/SKILL.md`);
    if (!result.ok) {
      throw new Error(
        `${id} failed validation: ${JSON.stringify(result.issues, null, 2)}`,
      );
    }
    expect(result.skill.id).toBe(id);
  });

  // Host-neutrality — no vendor-specific command injection, no leftover placeholders.
  describe.each(skillIds)("host-neutrality of %s", (id) => {
    const body = readSkill(id);

    it("uses no $ARGUMENTS command-injection token", () => {
      expect(body).not.toMatch(/\$ARGUMENTS/);
    });

    it("uses no bang-command injection lines", () => {
      // Reject any line whose first non-space character is a bang followed by a non-space token — the
      // Claude "run this command" injection form in general, not just a fixed runner allowlist. The
      // `(?!\[)` negative lookahead keeps markdown image syntax (`![alt](src)`) allowed.
      expect(body).not.toMatch(/^\s*!(?!\[)\S/m);
    });

    it("carries no retired placeholders", () => {
      // Case-sensitive so the live `VladimirMakarevich` owner is not confused with the retired lower
      // dashed placeholder.
      expect(body).not.toContain("vladimir-makarevich");
      expect(body).not.toContain("wastech-mdlint.dev");
    });

    it("uses the real repository slug", () => {
      expect(body).toContain("VladimirMakarevich/wastech-mdlint");
    });
  });
});

// One tag publishes the CLI and tags the skills, so a skill's `compatibility` is a claim about which
// CLI release it was written against. Nothing but this test connects the two: the field is free
// prose the frontmatter schema accepts in any shape, and a version bump that misses it leaves three
// skills confidently naming a version that was never published. That failure is invisible in the
// repository — every command a skill names still exists here — and only shows up once an agent runs
// the skill against a CLI whose surface has moved.
const cliVersion = (
  JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../cli/package.json",
      ),
      "utf8",
    ),
  ) as { version: string }
).version;

describe("skill compatibility is coupled to the published CLI version", () => {
  it.each(skillIds)("%s names the CLI version it ships with", (id) => {
    const parsed = parseStaticSkill(readSkill(id), `skills/${id}/SKILL.md`);
    if (!parsed.ok) {
      throw new Error(`${id} failed validation`);
    }

    const compatibility = parsed.skill.frontmatter.compatibility;

    // Asserted as present before being matched: the field is optional in the schema, and an absent
    // one would otherwise satisfy a substring check against `undefined` with no complaint.
    expect(
      compatibility,
      `skills/${id}/SKILL.md declares no compatibility field.`,
    ).toBeTypeOf("string");

    // Matched as a whole version rather than as a substring, so `0.1.0` is not satisfied by a stray
    // `10.1.0` or `0.1.09`. The trailing boundary rejects a digit or a further dotted component but
    // must still allow sentence punctuation, since the version routinely ends a sentence.
    const wholeVersion = new RegExp(
      String.raw`(?<![\d.])${cliVersion.replace(/\./g, String.raw`\.`)}(?!\d)(?!\.\d)`,
    );

    expect(
      wholeVersion.test(compatibility!),
      `skills/${id}/SKILL.md compatibility does not name @wastech-mdlint/cli ${cliVersion}: ` +
        `"${compatibility!}". Bump it in the same change that bumps the package versions.`,
    ).toBe(true);
  });
});
