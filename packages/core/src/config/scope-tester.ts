import path from "node:path";

import {
  isGitIgnored,
  readIgnoreLayer,
  type IgnoreLayer,
} from "../discovery/gitignore-layers.js";
import { matchesConfigGlob, prunesDirectory } from "../discovery/globs.js";
import type { LintConfig } from "./config-schema.js";
import { resolveCorpusScope } from "./corpus-scope.js";

// The corpus scope applied to one path at a time, for a long-running host that has to judge a single
// path — one a watcher reported, one a document links to — without walking the repository again.
// The walk in `loadDocuments` decides the same question for every file at once; both go through
// `resolveCorpusScope`, `prunesDirectory` and `isGitIgnored`, in the same order, so a path this
// calls out of scope is one the walk would never have reached.

export type ScopeTester = {
  /**
   * Whether `include` names `relPath`: a file the corpus holds as a document unless `exclude` or a
   * `.gitignore` keeps it out.
   */
  includes(relPath: string): boolean;
  /**
   * Whether `exclude`, or a `.gitignore` this tester honors, keeps `relPath` out of the walk — by
   * matching the path itself, or by pruning a directory above it. `isDirectory` picks the form of the
   * question the walk asks of a directory: pruned with its subtree, and matched by directory-only
   * `.gitignore` patterns such as `build/`.
   */
  excludes(relPath: string, isDirectory: boolean): Promise<boolean>;
};

export function createScopeTester(params: {
  cwd: string;
  config: LintConfig;
  // Whether `.gitignore` files count. Left out, the config's own `respectGitignore` decides, which is
  // the rule for corpus membership. A host that hands files out may pass `true`: a `.gitignore` is
  // where a repository names what it does not share, such as a local `.env`, whatever it lints.
  respectGitignore?: boolean;
}): ScopeTester {
  const rootDir = path.resolve(params.cwd);
  const scope = resolveCorpusScope(params.config);
  const respectGitignore = params.respectGitignore ?? scope.respectGitignore;
  // One read per directory for the tester's lifetime. A host creates a new tester whenever it reloads
  // after a `.gitignore` changed, so a cached layer never outlives the file it was read from; and a
  // layer is never mutated after it is cached, which `isGitIgnored` requires of every layer it is given.
  const layers = new Map<string, Promise<IgnoreLayer | undefined>>();
  const layerOf = (relDirectory: string): Promise<IgnoreLayer | undefined> => {
    let layer = layers.get(relDirectory);
    if (layer === undefined) {
      layer = readIgnoreLayer(
        path.join(rootDir, ...relDirectory.split("/").filter(Boolean)),
        relDirectory,
      );
      layers.set(relDirectory, layer);
    }
    return layer;
  };

  return {
    includes: (relPath) => matchesConfigGlob(relPath, scope.include),
    async excludes(relPath, isDirectory) {
      // Outermost first, as the walk descends: each directory is judged against the layers of the
      // directories above it, and only then contributes its own `.gitignore` to what lies below.
      const active: IgnoreLayer[] = [];
      const pushLayer = async (relDirectory: string): Promise<void> => {
        const layer = respectGitignore
          ? await layerOf(relDirectory)
          : undefined;
        if (layer !== undefined) {
          active.push(layer);
        }
      };
      await pushLayer("");
      const segments = relPath.split("/");
      for (let end = 1; end < segments.length; end += 1) {
        const directory = segments.slice(0, end).join("/");
        if (
          prunesDirectory(directory, scope.exclude) ||
          isGitIgnored(directory, true, active)
        ) {
          return true;
        }
        await pushLayer(directory);
      }
      return isDirectory
        ? prunesDirectory(relPath, scope.exclude) ||
            isGitIgnored(relPath, true, active)
        : matchesConfigGlob(relPath, scope.exclude) ||
            isGitIgnored(relPath, false, active);
    },
  };
}
