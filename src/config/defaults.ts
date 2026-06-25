import type { AuditConfig, ConfigFileName } from "../types.js";

export const SUPPORTED_CONFIG_FILE_NAMES: ConfigFileName[] = [
  "wastech-ctxlint.config.json",
  "wastech-ctxlint.config.cjs",
  "wastech-ctxlint.config.mjs"
];

export const DEFAULT_CONFIG: AuditConfig = {
  include: ["**/*.md"],
  exclude: ["node_modules/**", "dist/**", ".git/**"],
  size: {
    maxBytesDefault: 64 * 1024,
    overrides: [
      { pattern: "CLAUDE.md", maxBytes: 32 * 1024 },
      { pattern: "skills/**/SKILL.md", maxBytes: 24 * 1024 }
    ]
  },
  llm: {
    entrypoints: ["CLAUDE.md", "AGENTS.md", "skills/**/SKILL.md"],
    maxTokensPerEntrypoint: 5000
  },
  links: {
    checkExternal: false,
    ignorePatterns: []
  },
  structure: {
    orphanDocs: "error",
    orphanExemptions: ["README.md", "index.md", "CLAUDE.md", "AGENTS.md", "skills/**/SKILL.md"],
    requiredSections: []
  }
};
