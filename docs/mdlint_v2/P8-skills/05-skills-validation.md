# P8.05 · Skill validation tests + host-neutrality check

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

## Goal

Validate all three skills against the schema and assert host-neutrality + correct surface
references.

## Sequence

- **Previous:** the three skills ([P8.02](02-skill-init.md), [P8.03](03-skill-fix.md),
  [P8.04](04-skill-impact.md)).
- **Next:** **Phase P9 — Distribution & release** (see [roadmap](../index.md)).
- **Depends on:** P8.02–P8.04 · **Blocks:** single-tag release (P9).

## Deliverables / steps

1. CI test: every `skills/*/SKILL.md` frontmatter validates against the schema
   ([P8.01](01-frontmatter-schema-model.md)/[S1](../requirements/04-skills-compile.md)).
2. **Host-neutrality check** ([S7](../requirements/04-skills-compile.md)): no Claude-specific
   command-injection syntax; placeholders (`vladimir-makarevich` / `wastech-mdlint.dev`) are
   gone, replaced with `VladimirMakarevich/wastech-mdlint`.
3. Sanity-check referenced commands/tools exist in the actual CLI/MCP surface
   (a guard against skill ↔ product drift).

## Decisions applied

- [S1](../requirements/04-skills-compile.md), [S5](../requirements/04-skills-compile.md),
  [S7](../requirements/04-skills-compile.md).

## Exit criteria

- [x] All skills pass frontmatter validation in CI.
- [x] Host-neutrality + placeholder checks pass; referenced commands/tools exist.
- [x] Phase P8 [exit criteria](index.md) satisfied.

## Implementation notes

The three checks are guards against **skill ↔ product drift**, so each is written to fail on a
real divergence rather than to merely pass today — the harder question throughout was "what silent
drift would this miss?", and the answer shaped every choice below.

- **Frontmatter reader without a YAML dependency.** `parseStaticSkill` (in
  `packages/core/src/skills/parse-static-skill.ts`) hand-parses the controlled subset the skills are
  authored in — top-level `key: "quoted-scalar"` lines plus one two-space `metadata:` map — and
  routes the result through the existing `validateSkill`/`skillFrontmatterSchema` (S1/S5) so static
  and generated skills validate against one contract. This matches the repo's standing "no YAML
  dependency" posture (`synthesize` hand-renders frontmatter for the same reason). The trade-off is
  deliberate: anything outside the authored subset is reported as a validation issue, never
  silently mis-parsed. The reader is kept **internal** — imported directly by the core tests, not
  re-exported from the package barrel — because it has no production caller and adding it to the
  public API would widen the supported surface with a test-only helper.
- **Strictness the schema alone would not catch.** Because the reader builds a plain object, several
  malformed-but-plausible files could slip past a naive parse, so each is rejected explicitly:
  duplicate keys (YAML would reject; a plain object lets the last win), an indented line after a
  top-level key dedents out of `metadata:` (the map is only the *active* parent while its children
  directly follow it), and a fence that merely *starts* with `---` (`----`, `--- extra`) — fences
  are matched line-by-line and must equal `---`. CRLF input is normalized first so a Windows
  checkout validates.
- **Host-neutrality (S7) rejects the general injection form.** The guard bans any non-image bang
  line (`/^\s*!(?!\[)\S/m`), not a fixed runner allowlist, since the requirement is "no
  Claude-specific command injection" in general; markdown images (`![alt](src)`) stay allowed.
- **Surface guards are derived from the skill text, not a hand-kept list.** The CLI and MCP checks
  parse the commands, flags, choice values, and tool/field references out of the SKILL.md bodies and
  assert them against the live surface — `--help` output, and the MCP `listTools` input/output
  schemas — so a stale expectation cannot pass while the skill drifts. Flag and choice-value checks
  are **command-scoped** (validated against the owning command's help), and the CLI half also runs
  the documented `--format json` commands against a fixture repo to pin the payload keys the skills
  instruct agents to read (`summary`/`messages`/`files`, slice `starts`/`matchKind`, impact
  `changedFile`/`directlyAffected`/…). The one accepted duplication: the ~3-line skill-reading
  helper is repeated across the core, CLI, and MCP test files because no host depends on another and
  core knows neither surface.

## Hand-off to next

P9 tags the validated skills together with the npm packages under one version (I4/I7).
