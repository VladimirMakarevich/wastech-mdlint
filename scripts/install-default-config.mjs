import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function copyDefaultConfigIfMissing(params = {}) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const sourcePath = path.resolve(
    params.sourcePath ?? path.join(scriptDir, "..", "wastech-mdlint.config.example.json")
  );
  const destinationRoot = path.resolve(params.destinationRoot ?? process.env.INIT_CWD ?? process.cwd());
  const destinationPath =
    path.resolve(params.destinationPath ?? path.join(destinationRoot, "wastech-mdlint.config.json"));

  if (sourcePath === destinationPath) {
    return { copied: false, destinationPath };
  }

  if (await pathExists(destinationPath)) {
    return { copied: false, destinationPath };
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);

  return { copied: true, destinationPath };
}

async function main() {
  try {
    await copyDefaultConfigIfMissing();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`wastech-mdlint: unable to copy default config: ${message}`);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await main();
}
