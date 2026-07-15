import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseStaticSkill } from "../src/skills/parse-static-skill.js";

// Resolve the committed `skills/` tree relative to this test file (repo root is three levels up from
// packages/core/test), the same anchoring the README docs-sync check uses.
const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../skills");

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
  it("ships exactly the three P8 skills", () => {
    expect(skillIds).toEqual(["wastech-mdlint-fix", "wastech-mdlint-impact", "wastech-mdlint-init"]);
  });

  // S1: every static skill's frontmatter validates against the one shared schema.
  it.each(skillIds)("validates %s frontmatter against the schema (S1)", (id) => {
    const result = parseStaticSkill(readSkill(id), `skills/${id}/SKILL.md`);
    if (!result.ok) {
      throw new Error(`${id} failed validation: ${JSON.stringify(result.issues, null, 2)}`);
    }
    expect(result.skill.id).toBe(id);
  });

  // S7: host-neutrality — no Claude-specific command injection, no leftover placeholders.
  describe.each(skillIds)("host-neutrality of %s (S7)", (id) => {
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
