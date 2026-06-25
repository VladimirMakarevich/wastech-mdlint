import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type { AuditConfig, LoadedConfig } from "../types.js";
import { DEFAULT_CONFIG, SUPPORTED_CONFIG_FILE_NAMES } from "./defaults.js";

const sizeOverrideSchema = z
  .object({
    pattern: z.string().min(1),
    maxBytes: z.number().int().positive()
  })
  .strict();

const requiredSectionRuleSchema = z
  .object({
    pattern: z.string().min(1),
    slugs: z.array(z.string().min(1))
  })
  .strict();

const configSchema = z
  .object({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    size: z
      .object({
        maxBytesDefault: z.number().int().positive().optional(),
        overrides: z.array(sizeOverrideSchema).optional()
      })
      .strict()
      .optional(),
    llm: z
      .object({
        entrypoints: z.array(z.string()).optional(),
        maxTokensPerEntrypoint: z.number().int().positive().optional()
      })
      .strict()
      .optional(),
    links: z
      .object({
        checkExternal: z.boolean().optional(),
        ignorePatterns: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    structure: z
      .object({
        orphanDocs: z.enum(["error", "warning", "off"]).optional(),
        orphanExemptions: z.array(z.string()).optional(),
        // Accepted for config compatibility, but intentionally ignored by v1 logic.
        requiredSections: z.array(requiredSectionRuleSchema).optional()
      })
      .strict()
      .optional()
  })
  .strict();

type RawAuditConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function cloneDefaults(): AuditConfig {
  return structuredClone(DEFAULT_CONFIG);
}

function mergeConfig(defaults: AuditConfig, overrides: RawAuditConfig): AuditConfig {
  return {
    include: overrides.include ?? defaults.include,
    exclude: overrides.exclude ?? defaults.exclude,
    size: {
      maxBytesDefault: overrides.size?.maxBytesDefault ?? defaults.size.maxBytesDefault,
      overrides: overrides.size?.overrides ?? defaults.size.overrides
    },
    llm: {
      entrypoints: overrides.llm?.entrypoints ?? defaults.llm.entrypoints,
      maxTokensPerEntrypoint:
        overrides.llm?.maxTokensPerEntrypoint ?? defaults.llm.maxTokensPerEntrypoint
    },
    links: {
      checkExternal: overrides.links?.checkExternal ?? defaults.links.checkExternal,
      ignorePatterns: overrides.links?.ignorePatterns ?? defaults.links.ignorePatterns
    },
    structure: {
      orphanDocs: overrides.structure?.orphanDocs ?? defaults.structure.orphanDocs,
      orphanExemptions:
        overrides.structure?.orphanExemptions ?? defaults.structure.orphanExemptions,
      requiredSections:
        overrides.structure?.requiredSections ?? defaults.structure.requiredSections
    }
  };
}

function formatZodPath(pathParts: Array<string | number>): string {
  if (pathParts.length === 0) {
    return "config";
  }

  return `config.${pathParts.join(".")}`;
}

function formatValidationError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `- ${formatZodPath(issue.path)}: ${issue.message}`);
  return `Invalid config:\n${lines.join("\n")}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverConfigPath(rootPath: string): Promise<string | undefined> {
  for (const fileName of SUPPORTED_CONFIG_FILE_NAMES) {
    const candidatePath = path.join(rootPath, fileName);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

async function readJsonConfig(configPath: string): Promise<unknown> {
  try {
    const text = await readFile(configPath, "utf8");
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to read JSON config at ${configPath}: ${message}`);
  }
}

async function readModuleConfig(configPath: string): Promise<unknown> {
  try {
    const moduleUrl = pathToFileURL(configPath).href;
    const loaded = (await import(moduleUrl)) as { default?: unknown };
    return loaded.default ?? loaded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to load config module at ${configPath}: ${message}`);
  }
}

async function readRawConfig(configPath: string): Promise<unknown> {
  if (configPath.endsWith(".ts")) {
    throw new ConfigError(
      `Unsupported config file extension for ${configPath}. TypeScript config files are not supported in v1.`
    );
  }

  if (configPath.endsWith(".json")) {
    return readJsonConfig(configPath);
  }

  if (configPath.endsWith(".cjs") || configPath.endsWith(".mjs")) {
    return readModuleConfig(configPath);
  }

  throw new ConfigError(`Unsupported config file extension for ${configPath}.`);
}

function validateConfig(rawConfig: unknown): RawAuditConfig {
  const parsed = configSchema.safeParse(rawConfig);

  if (!parsed.success) {
    throw new ConfigError(formatValidationError(parsed.error));
  }

  return parsed.data;
}

export async function loadConfig(params: {
  rootPath: string;
  explicitConfigPath?: string;
}): Promise<LoadedConfig> {
  const rootPath = path.resolve(params.rootPath);
  const explicitConfigPath = params.explicitConfigPath
    ? path.resolve(params.explicitConfigPath)
    : undefined;
  const configPath = explicitConfigPath ?? (await discoverConfigPath(rootPath));

  if (explicitConfigPath && !(await fileExists(explicitConfigPath))) {
    throw new ConfigError(`Config file not found: ${explicitConfigPath}`);
  }

  if (configPath === undefined) {
    return {
      config: cloneDefaults()
    };
  }

  const rawConfig = await readRawConfig(configPath);
  const validatedConfig = validateConfig(rawConfig);

  return {
    config: mergeConfig(cloneDefaults(), validatedConfig),
    configPath
  };
}
