import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { AuditConfig, MarkdownFile } from "../types.js";
import { matchesConfigGlob, normalizeRelativePath } from "./globs.js";

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

function isInsideRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shouldPruneDirectory(relativeDirectoryPath: string, config: AuditConfig): boolean {
  return matchesConfigGlob(`${relativeDirectoryPath}/__directory_probe__`, config.exclude);
}

function shouldIncludeFile(relativeFilePath: string, config: AuditConfig): boolean {
  return (
    matchesConfigGlob(relativeFilePath, config.include) &&
    !matchesConfigGlob(relativeFilePath, config.exclude)
  );
}

async function collectMarkdownFiles(
  currentDirectoryPath: string,
  rootRealPath: string,
  rootDisplayPath: string,
  config: AuditConfig,
  files: MarkdownFile[]
): Promise<void> {
  const entries = await readdir(currentDirectoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDirectoryPath, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootDisplayPath, absolutePath));

    if (entry.isDirectory()) {
      if (shouldPruneDirectory(relativePath, config)) {
        continue;
      }

      await collectMarkdownFiles(absolutePath, rootRealPath, rootDisplayPath, config, files);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const resolvedTargetPath = await realpath(absolutePath).catch(() => undefined);

      if (resolvedTargetPath === undefined || !isInsideRoot(resolvedTargetPath, rootRealPath)) {
        continue;
      }

      const resolvedStats = await stat(absolutePath).catch(() => undefined);

      if (resolvedStats === undefined || !resolvedStats.isFile()) {
        continue;
      }

      if (!shouldIncludeFile(relativePath, config)) {
        continue;
      }

      files.push({
        path: relativePath,
        absolutePath,
        bytes: resolvedStats.size
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!shouldIncludeFile(relativePath, config)) {
      continue;
    }

    const fileStats = await stat(absolutePath);

    files.push({
      path: relativePath,
      absolutePath,
      bytes: fileStats.size
    });
  }
}

export async function discoverMarkdownFiles(params: {
  rootPath: string;
  config: AuditConfig;
}): Promise<MarkdownFile[]> {
  const rootDisplayPath = path.resolve(params.rootPath);
  const rootStats = await stat(rootDisplayPath).catch(() => undefined);

  if (rootStats === undefined) {
    throw new DiscoveryError(`Scan root not found: ${rootDisplayPath}`);
  }

  if (!rootStats.isDirectory()) {
    throw new DiscoveryError(`Scan root is not a directory: ${rootDisplayPath}`);
  }

  const rootRealPath = await realpath(rootDisplayPath);
  const files: MarkdownFile[] = [];

  await collectMarkdownFiles(rootDisplayPath, rootRealPath, rootDisplayPath, params.config, files);

  files.sort((left, right) => left.path.localeCompare(right.path));

  return files;
}
