# Annotated config reference

> [Guide index](README.md) · [Configuration guide](configuration.md) · [Rules index](rules/README.md)

This is a single `wastech-mdlint.config.json` that exercises **every** option the linter accepts, with a comment on each. It is a _reference_, not a recommended starting config — you would never enable all 24 rules at once with every option. Copy the pieces you need. For a curated starter, run [`wastech-mdlint init`](cli.md#init).

Config is **JSONC**: `//` comments and trailing commas are allowed. Unknown keys — top-level, in any rule's `options`, or under `compile` — are rejected. Every field below is drawn from the generated schema (`wastech-mdlint schema`).

```jsonc
{
  // Local path to the JSON schema for editor completion. NEVER a remote URL.
  // `init` points this at ./node_modules/@wastech-mdlint/cli/schema.json when the CLI is installed
  // locally, or at a project-local ./schema.json when custom rules are present or nothing is
  // installed to point at (the `npx` case). It generates that file unless one is already there —
  // an existing schema.json is never replaced, so check the write summary if you had one.
  "$schema": "./node_modules/@wastech-mdlint/cli/schema.json",

  // Files to lint (globs). Default when omitted: ["**/*.md"].
  //
  // Anchoring: a pattern WITH a "/" is root-anchored, one WITHOUT is matched at any depth.
  // So "NOTE.md" and "*.md" match at any depth, "./NOTE.md" matches only the root file, and
  // "node_modules/**" prunes only the ROOT copy while "**/node_modules/**" prunes every copy.
  // Ordering: entries are applied left to right, a leading "!" subtracts, and the last entry
  // that matches a path wins. Full rules: ./configuration.md#glob-semantics
  "include": ["**/*.md"],

  // Globs to remove from the set. `exclude` WINS over `include`. Same anchoring and ordering as
  // `include` — but a "!" here cannot reach into a directory an earlier entry already pruned.
  "exclude": ["**/node_modules/**", "**/dist/**", "**/.git/**"],

  // When true, also skip files ignored by .gitignore. Default: false — but a fresh `init` write
  // sets an explicit true, matching the trees its own scan skipped (a `merge` never adds it).
  "respectGitignore": false,

  // Shared settings inherited by the rules that understand them.
  "settings": {
    // Docs-site URL→file routing (e.g. Astro Starlight). Inherited by REF rules and graph rules;
    // any rule that accepts `siteRouter` in its options can override this per rule.
    "siteRouter": {
      "preset": "starlight", // routing preset name
      "contentDir": "src/content/docs", // where routed content lives
      "defaultLocale": "en", // locale stripped from routed URLs
    },

    // Feeds the context graph's `id-ref` edges so ID references count toward GRP-001 (cycles) and
    // GRP-002 (incoming references). Mirrors REF-005's shape but is configured separately.
    // All three fields are required when `idRef` is present.
    "idRef": {
      "idPattern": "REQ-\\d+", // regex identifying an ID token
      "definitions": ["docs/requirements/**/*.md"], // files where IDs are defined
      "idColumn": "ID", // table column holding the ID
    },
  },

  // The rules to run. Each entry: { rule, severity?, options? }. A rule may appear more than once
  // with different files/options. severity is "error" | "warning" | "off" ("off" = documented but
  // disabled). Omitting severity uses the rule's built-in default. Rule IDs are case-insensitive
  // and dash-optional (ref-001 → REF-001).
  "rules": [
    // ── TBL — tables ────────────────────────────────────────────────────────────────────────
    // TBL-001: required header columns exist.
    {
      "rule": "TBL-001",
      "options": {
        "requiredColumns": ["ID", "Owner", "Status"], // required (≥1)
        "section": "Requirements", // only tables under this heading (optional)
        "files": ["docs/**/*.md"],
        "exclude": ["docs/archive/**"],
      },
    },
    // TBL-002: target cells are non-empty. FIXABLE (--fix fills empty cells with ` TODO `).
    {
      "rule": "TBL-002",
      "options": {
        "columns": ["Owner"], // which columns must be non-empty; omit to check all
        "section": "Requirements",
        "files": [],
        "exclude": [],
      },
    },
    // TBL-003: cell value falls within an allowed set.
    {
      "rule": "TBL-003",
      "options": {
        "column": "Status", // required
        "values": ["todo", "doing", "done"], // required (≥1)
        "caseSensitive": false, // default false
        "section": "Requirements",
      },
    },
    // TBL-004: cell value matches a regex.
    {
      "rule": "TBL-004",
      "options": {
        "column": "ID", // required
        "pattern": "^REQ-\\d+$", // required (regex source)
        "flags": "i", // optional regex flags
        "section": "Requirements",
      },
    },
    // TBL-005: cross-column conditional (when → then).
    {
      "rule": "TBL-005",
      "options": {
        "when": { "column": "Status", "equals": "done" }, // predicate (column required; equals|matches|notEmpty)
        "then": { "column": "Owner", "notEmpty": true }, // requirement when `when` holds
        "section": "Requirements",
      },
    },
    // TBL-006: column IDs are unique across files (project scope).
    {
      "rule": "TBL-006",
      "options": {
        "column": "ID", // required
        "idPattern": "REQ-\\d+", // optional: only values matching this count as IDs
        "section": "Requirements",
      },
    },

    // ── SEC — sections ──────────────────────────────────────────────────────────────────────
    // SEC-001: required sections present. FIXABLE (--fix appends a scaffold `## X` + TODO body).
    {
      "rule": "SEC-001",
      "options": {
        "sections": ["Overview", "Usage", "License"], // required (≥1)
        "files": ["**/*.md"],
        "exclude": [],
      },
    },
    // SEC-002: sections appear in the required order.
    {
      "rule": "SEC-002",
      "options": {
        "order": ["Overview", "Usage", "License"], // required (≥1)
        "level": 2, // only headings at this level (optional)
        "section": "Reference", // only within this parent section (optional)
      },
    },
    // SEC-003: sections conform to a reference template's heading structure (project scope).
    {
      "rule": "SEC-003",
      "options": {
        // required: template file — repo-relative only; an absolute or `..`-escaping
        // path is rejected unread so a config cannot read outside the analyzed root
        "template": "docs/_templates/adr.md",
        "level": 2, // heading level to compare (optional)
      },
    },

    // ── STR — structure ─────────────────────────────────────────────────────────────────────
    // STR-001: required files exist (project scope). `files` is the required SET, not a filter.
    {
      "rule": "STR-001",
      "options": {
        // required: a literal entry is resolved on disk, repo-relative and root-pinned (so it
        // can require a non-Markdown file); a glob entry only matches the Markdown corpus
        "files": ["README.md", "LICENSE", "docs/index.md"], // required (≥1)
      },
    },

    // ── REF — references ────────────────────────────────────────────────────────────────────
    // REF-001: relative links resolve to a file.
    {
      "rule": "REF-001",
      "options": {
        // NOT file scope: these globs match the link *target* being probed, so this skips links
        // *to* any CHANGELOG.md, from anywhere. REF-001 has no `files`/`exclude` file scope.
        "exclude": ["**/CHANGELOG.md"],
        "siteRouter": {
          "preset": "starlight",
          "contentDir": "src/content/docs",
          "defaultLocale": "en",
        },
      },
    },
    // REF-002: link anchors match a heading slug.
    {
      "rule": "REF-002",
      "options": {
        "siteRouter": { "preset": "starlight" },
        "files": [],
        "exclude": [],
      },
    },
    // REF-003: image targets resolve to a file. As on REF-001, `exclude` matches the image
    // *target* (here: badge images produced elsewhere), not the document holding the image.
    { "rule": "REF-003", "options": { "exclude": ["**/badges/**"] } },
    // REF-004: cross-zone links are declared in the zone's Dependencies section.
    {
      "rule": "REF-004",
      "options": {
        "zonesDir": "docs/zones", // required: directory whose subfolders are "zones"
        "dependencySection": "Dependencies", // section listing allowed cross-zone deps (optional)
      },
    },
    // REF-005: IDs are traceable between definitions and references (project scope). All required.
    {
      "rule": "REF-005",
      "options": {
        "definitions": ["docs/requirements/**/*.md"],
        "references": ["docs/design/**/*.md"],
        "idColumn": "ID",
        "idPattern": "REQ-\\d+",
      },
    },
    // REF-006: references do not depend on less-stable entities (project scope).
    {
      "rule": "REF-006",
      "options": {
        "stabilityColumn": "Stability", // required
        "stabilityOrder": ["experimental", "stable"], // required (≥2, least→most stable)
        "definitions": ["docs/**/*.md"], // required
        "references": ["docs/**/*.md"], // required
        "idColumn": "ID", // required
        "idPattern": "REQ-\\d+", // optional
      },
    },

    // ── CTX — content quality ───────────────────────────────────────────────────────────────
    // CTX-001: sections are not empty or placeholder-only.
    {
      "rule": "CTX-001",
      "options": {
        "section": "Overview", // limit to one section (optional)
        "placeholders": ["LOREM", "PLACEHOLDER"], // EXTENDS the defaults TBD/TODO/WIP/FIXME/N/A
        "files": [],
        "exclude": [],
      },
    },
    // CTX-002: all checklist items are checked. (Checklist completeness lives here — there is no CHK category.)
    {
      "rule": "CTX-002",
      "options": {
        "section": "Acceptance criteria",
        "files": [],
        "exclude": [],
      },
    },
    // CTX-003: content uses canonical glossary terms instead of aliases (project scope).
    {
      "rule": "CTX-003",
      "options": {
        "glossary": "docs/glossary.md", // required
        "termColumn": "Term", // required
        "aliasColumn": "Aliases", // optional
        "section": "Glossary", // optional
      },
    },

    // ── GRP — graph integrity (all project scope) ───────────────────────────────────────────
    // GRP-001: no circular references between documents. Takes no options — the graph is corpus-wide
    // (narrow it with the top-level include/exclude); any options key is a config error.
    { "rule": "GRP-001" },
    // GRP-002: documents have at least one incoming reference (except entry points).
    {
      "rule": "GRP-002",
      "options": {
        "entryPoints": ["README.md", "docs/index.md"], // roots exempt from the orphan check
        "files": [], // scopes reporting only; the graph stays corpus-wide
        "exclude": [],
      },
    },
    // GRP-003: IDs are carried forward across pipeline stages.
    {
      "rule": "GRP-003",
      "options": {
        "chain": [
          // required, ≥2 stages; each: { stage, files, refColumn (required), idColumn? }
          {
            "stage": "requirements",
            "files": ["docs/requirements/**/*.md"],
            "idColumn": "ID",
            "refColumn": "ID",
          },
          {
            "stage": "design",
            "files": ["docs/design/**/*.md"],
            "idColumn": "ID",
            "refColumn": "Requirement",
          },
        ],
        "idPattern": "REQ-\\d+", // optional
      },
    },

    // ── SIZE / LLM — context hygiene ────────────────────────────────────────────────────────
    // SIZE-001: file stays within byte/line/token budgets. Metrics are independent; within one
    // metric the highest crossed threshold is reported (one finding per metric).
    {
      "rule": "SIZE-001",
      "options": {
        "bytes": { "warn": 40000, "error": 80000 },
        "lines": { "warn": 800, "error": 1500 },
        "tokens": { "warn": 10000, "error": 20000 },
        "overrides": [
          // per-glob thresholds; first match wins
          {
            "pattern": "docs/reference/**",
            "tokens": { "warn": 30000, "error": 60000 },
          },
        ],
      },
    },
    // LLM-001: eager-import (@path) closure per entrypoint stays within a token budget (project scope).
    {
      "rule": "LLM-001",
      "options": {
        "entrypoints": ["CLAUDE.md", "AGENTS.md"], // required (≥1)
        "maxTokensPerEntrypoint": 20000, // required (positive integer)
      },
    },

    // ── custom — declarative rule ───────────────────────────────────────────────────────────
    // Composes the closed assertion vocabulary from config. `id` must be namespaced and must not
    // shadow a built-in prefix (CTX/GRP/LLM/REF/SEC/SIZE/STR/TBL). See rules/custom.md for all kinds.
    {
      "rule": "custom",
      "id": "REQ-OWNER", // required, namespaced
      "description": "Each requirement row must have an Owner", // optional (defaults to the id)
      "severity": "error", // optional (default error)
      "target": "table", // optional; must match the kind's target: checklist | content | link | section | table
      "options": {
        "files": ["docs/requirements/**/*.md"],
        "exclude": [],
        "assert": { "kind": "columnNotEmpty", "column": "Owner" }, // one of 13 assertion kinds
      },
    },
  ],

  // Config for the `compile` command (generates SKILL.md). Required by that command; `skill` is
  // mandatory inside it.
  "compile": {
    // Where `compile` writes SKILL.md. Precedence: --outdir flag → this → .claude/skills/wastech-mdlint/
    "outdir": ".claude/skills/wastech-mdlint",
    "skill": {
      "name": "my-project-context", // required, non-empty
      "description": "Project docs context skill", // required, non-empty
    },
    // Gate which SKILL.md sections render (all default true).
    "sections": {
      "architecture": true,
      "rules": true,
      "dependencies": true,
      "workflow": true,
    },
    // Wording of the generated "Working with dependencies" block. Default "generic".
    "commandPreset": "generic", // "claude" | "generic" | "none"
    // In-degree threshold to classify a document as a hub. Default 3.
    "hubMinInDegree": 3,
  },
}
```

## When it is rejected

Anything the schema rejects comes back as `Invalid config at <the file that was read>:` followed by one `- <path>: <problem>` line per problem, and exits `2`. Paths are `config` + `.key` + `[n]`, matching the structure above. Three real examples:

```text
Invalid config at wastech-mdlint.config.json:
- config.rules[0].severity: Invalid option: expected one of "error"|"warning"|"off"
```

```text
Invalid config at wastech-mdlint.config.json:
- config.rules[0].options: Unrecognized key: "token"
```

```text
Invalid config at wastech-mdlint.config.json:
- config.rules[0]: Unknown rule "TBL-03". Did you mean "TBL-003"?
```

The middle one is a `SIZE-001` entry whose `tokens` budget was spelled `token`: every rule's option object is strict, so a typo'd key is rejected rather than silently ignored.

A **syntax** error is reported differently, because it happens before the schema sees anything: `Failed to parse JSONC config at wastech-mdlint.config.json: CloseBraceExpected at offset 412`. Byte offsets rather than config paths are the only location a half-parsed file can honestly offer.

See [Validation & errors](configuration.md#validation--errors) for the notation and for why a file with two different kinds of problem takes two runs to clear.

## Notes

- The `custom` entry shows one assertion; the [custom rule page](rules/custom.md) lists all 13 assertion kinds (`requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnMatches`, `columnUnique`, `crossColumn`, `sectionPresent`, `sectionOrder`, `contentNotMatch`, `noPlaceholders`, `allChecked`, `linkResolves`, `imageResolves`).
- `siteRouter` shown on individual REF rules (REF-001/REF-002 only) **overrides** `settings.siteRouter` for that rule; most projects set it once under `settings`. The graph rules read it only through the shared graph, so they take no `siteRouter` of their own.
- Rules that operate over the whole corpus (identity/graph rules) may intentionally omit `files`/`exclude` — see each rule's page for its exact option set. Two of them spell one of the names with a different meaning, which is why the comments above call it out inline: `STR-001.files` is the required-file set, and `REF-001`/`REF-003`'s `exclude` filters link/image targets.
- On the rules that do take file scope, it also bounds `--fix` (SEC-001, TBL-002): an excluded file is never rewritten, not just never reported.
