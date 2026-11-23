import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildContextGraph,
  candidateEscapesRoot,
  compareStrings,
  CONFIG_FILE_NAME,
  filePart,
  lintContext,
  loadConfiguration,
  loadContext,
  parseDocument,
  resolveTargetCandidates,
  type ContextGraph,
  type LintResult,
  type LoadedConfiguration,
  type ParsedDocument,
} from "@wastech-mdlint/core";

// The viewer shows exactly the corpus the linter checks — same config, same include/exclude, same
// gitignore handling — by loading it through core's `loadContext` rather than walking the tree
// itself. A viewer with its own idea of which files are documents would show pages the linter never
// looked at and hide ones it reports on.

export type ResolvedTarget =
  | { kind: "document"; path: string }
  | { kind: "file"; path: string }
  | { kind: "missing" };

type RepositoryRoot = { rootDir: string; rootRealPath: string };

type SiteRouter = LoadedConfiguration["settings"]["siteRouter"];

type CorpusState = {
  loaded: LoadedConfiguration;
  documents: Map<string, ParsedDocument>;
  graph: ContextGraph;
  // Per document, the non-Markdown repository files it links to or embeds. This is the whole set of
  // files `/file/` will serve: a path is reachable only because a document in the corpus points at
  // it, so a request cannot read an arbitrary file just by naming it.
  linkedFiles: Map<string, Set<string>>;
};

// Names a directory link falls through to, in the order GitHub picks them for a folder view.
const DIRECTORY_INDEX_NAMES = ["README.md", "readme.md", "index.md"];

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Whether a link target leaves the repository (a URL, `mailto:`, a protocol-relative `//host`). */
export function isExternalTarget(target: string): boolean {
  return SCHEME.test(target) || target.startsWith("//");
}

export class Corpus {
  private constructor(
    private readonly root: RepositoryRoot,
    private readonly configPathOption: string | undefined,
    // Replaced as a whole, never mutated, so a request rendered while an update is in flight sees
    // one consistent snapshot rather than new documents against an old graph.
    private state: CorpusState,
  ) {}

  static async load(params: {
    cwd: string;
    configPath?: string;
  }): Promise<Corpus> {
    const rootDir = path.resolve(params.cwd);
    const root = { rootDir, rootRealPath: await realpath(rootDir) };
    return new Corpus(
      root,
      params.configPath,
      await loadState(root, params.configPath),
    );
  }

  get rootDir(): string {
    return this.root.rootDir;
  }

  get documents(): ReadonlyMap<string, ParsedDocument> {
    return this.state.documents;
  }

  get graph(): ContextGraph {
    return this.state.graph;
  }

  /** The configuration the corpus was loaded with, replaced with it on a full reload. */
  get configuration(): LoadedConfiguration {
    return this.state.loaded;
  }

  /** Reload configuration and every document from disk. */
  async reload(): Promise<void> {
    this.state = await loadState(this.root, this.configPathOption);
  }

  /**
   * Bring the corpus up to date with a set of changed repo-relative paths.
   *
   * A full reload costs a walk and a parse of every document — seconds on a repository with a few
   * hundred of them — while re-parsing the one file that was saved and rebuilding the graph costs
   * milliseconds. So an edit to a known document is applied in place, and only what can change
   * *which* files are documents (a new Markdown path, the config, a `.gitignore`) pays for a full
   * reload, because deciding membership means re-running core's include/exclude/gitignore discovery.
   *
   * `structural` reports that the set of documents may have changed, which every open page needs to
   * know because each one shows the document tree.
   */
  async applyChanges(
    paths: readonly string[],
  ): Promise<{ changed: string[]; structural: boolean }> {
    const { loaded } = this.state;
    const needsFullReload = paths.some(
      (changedPath) =>
        isCorpusControlFile(
          changedPath,
          loaded.configPath,
          this.root.rootDir,
        ) ||
        (!this.state.documents.has(changedPath) &&
          /\.mdx?$/i.test(changedPath)),
    );
    if (needsFullReload) {
      await this.reload();
      return { changed: [...paths].sort(compareStrings), structural: true };
    }

    const documents = new Map(this.state.documents);
    const changed: string[] = [];
    let structural = false;
    for (const changedPath of paths) {
      const previous = documents.get(changedPath);
      if (previous === undefined) {
        continue;
      }
      const content = await readRepositoryFile(this.root, changedPath);
      if (content === undefined) {
        documents.delete(changedPath);
        structural = true;
        changed.push(changedPath);
      } else if (content !== previous.content) {
        documents.set(
          changedPath,
          parseDocument({ path: changedPath, content }),
        );
        changed.push(changedPath);
      }
    }
    if (changed.length === 0) {
      return { changed, structural };
    }

    // Links resolve against the whole document set, so linked files are recomputed only once every
    // changed document is in the map.
    const linkedFiles = new Map(this.state.linkedFiles);
    for (const changedPath of changed) {
      const document = documents.get(changedPath);
      if (document === undefined) {
        linkedFiles.delete(changedPath);
      } else {
        linkedFiles.set(
          changedPath,
          await collectLinkedFiles(
            this.root,
            document,
            documents,
            loaded.settings.siteRouter,
          ),
        );
      }
    }
    this.state = {
      loaded,
      documents,
      graph: buildContextGraph(documents, {
        siteRouter: loaded.settings.siteRouter,
        idRef: loaded.settings.idRef,
      }),
      linkedFiles,
    };
    return { changed: changed.sort(compareStrings), structural };
  }

  /**
   * Where a local link or image target written in `fromPath` points.
   *
   * Candidates come from core's `resolveTargetCandidates`, the helper the context graph and the REF
   * rules share, so a link the viewer can follow is a link REF-001 accepts and the reverse. Images
   * resolve without the site router for the same reason core gives: a router maps URLs to Markdown
   * sources, never to assets. A directory falls through to its README, which REF-001 does not do; a
   * folder link that opens its README is what a reader expects from GitHub.
   */
  resolve(fromPath: string, target: string, isImage: boolean): ResolvedTarget {
    const { documents, linkedFiles, loaded } = this.state;
    const linked = linkedFiles.get(fromPath);
    for (const candidate of safeCandidates(
      fromPath,
      target,
      isImage,
      loaded.settings.siteRouter,
    )) {
      if (documents.has(candidate)) {
        return { kind: "document", path: candidate };
      }
      const index = directoryIndex(candidate, documents);
      if (index !== undefined) {
        return { kind: "document", path: index };
      }
      if (linked?.has(candidate) === true) {
        return { kind: "file", path: candidate };
      }
    }
    return { kind: "missing" };
  }

  isLinkedFile(relPath: string): boolean {
    for (const files of this.state.linkedFiles.values()) {
      if (files.has(relPath)) {
        return true;
      }
    }
    return false;
  }

  /** Documents that link to `relPath`, each once, in stable order. */
  backlinks(relPath: string): string[] {
    const sources = new Set<string>();
    for (const edge of this.state.graph.edges) {
      if (edge.to === relPath && edge.from !== relPath) {
        sources.add(edge.from);
      }
    }
    return [...sources].sort(compareStrings);
  }

  /** The absolute path of a repository file the viewer may read; see `resolveRepositoryFile`. */
  resolveFile(relPath: string): Promise<string | undefined> {
    return resolveRepositoryFile(this.root, relPath);
  }

  /**
   * Lint the corpus as it is in memory now, with the configured rules.
   *
   * Through core's `lintContext`, which gives exactly what `wastech-mdlint lint` gives for the same
   * tree but reuses the parsed documents and graph instead of discovering and parsing everything
   * again — a fraction of a second after an edit rather than the seconds a fresh run takes.
   */
  lint(): LintResult {
    const { loaded, documents, graph } = this.state;
    return lintContext({
      cwd: this.root.rootDir,
      context: { documents, graph },
      rules: loaded.rules,
      settings: loaded.settings,
    });
  }
}

async function loadState(
  root: RepositoryRoot,
  configPath: string | undefined,
): Promise<CorpusState> {
  const loaded = await loadConfiguration({
    cwd: root.rootDir,
    explicitConfigPath: configPath,
  });
  const { documents, graph } = await loadContext({
    cwd: root.rootDir,
    config: loaded.config,
    settings: loaded.settings,
  });
  // Documents are checked concurrently: each check is a few filesystem round trips, and awaiting them
  // one document at a time added seconds to startup on a corpus of a few hundred documents.
  // `Promise.all` keeps the input order, so the map's order stays the corpus order.
  const linkedFiles = new Map(
    await Promise.all(
      [...documents.values()].map(
        async (document) =>
          [
            document.path,
            await collectLinkedFiles(
              root,
              document,
              documents,
              loaded.settings.siteRouter,
            ),
          ] as const,
      ),
    ),
  );
  return { loaded, documents, graph, linkedFiles };
}

async function collectLinkedFiles(
  root: RepositoryRoot,
  document: ParsedDocument,
  documents: ReadonlyMap<string, ParsedDocument>,
  siteRouter: SiteRouter,
): Promise<Set<string>> {
  const files = new Set<string>();
  const targets = [
    ...document.links
      .filter((link) => link.kind === "local-file")
      .map((link) => ({ target: link.rawTarget, isImage: false })),
    ...document.images.map((image) => ({
      target: image.rawTarget,
      isImage: true,
    })),
  ];
  for (const { target, isImage } of targets) {
    for (const candidate of safeCandidates(
      document.path,
      target,
      isImage,
      siteRouter,
    )) {
      if (
        documents.has(candidate) ||
        directoryIndex(candidate, documents) !== undefined
      ) {
        break;
      }
      if ((await resolveRepositoryFile(root, candidate)) !== undefined) {
        files.add(candidate);
        break;
      }
    }
  }
  return files;
}

// Core's candidate list for a written target, minus anything that climbs out of the repository: such
// a target can never be a document and must never become a file the viewer serves.
function safeCandidates(
  fromPath: string,
  target: string,
  isImage: boolean,
  siteRouter: SiteRouter,
): string[] {
  const targetFile = filePart(target);
  if (targetFile.length === 0 || isExternalTarget(targetFile)) {
    return [];
  }
  return resolveTargetCandidates(
    fromPath,
    targetFile,
    isImage ? undefined : siteRouter,
  ).filter((candidate) => !candidateEscapesRoot(candidate));
}

function directoryIndex(
  candidate: string,
  documents: ReadonlyMap<string, ParsedDocument>,
): string | undefined {
  const directory = candidate.replace(/\/+$/, "");
  for (const name of DIRECTORY_INDEX_NAMES) {
    const indexPath =
      directory === "" || directory === "." ? name : `${directory}/${name}`;
    if (documents.has(indexPath)) {
      return indexPath;
    }
  }
  return undefined;
}

/**
 * The absolute path of a repository file, or `undefined` if it is missing, not a regular file, or —
 * through a symlink — outside the repository. Core's loader applies the same symlink rule to the
 * documents it reads; this applies it to every file the viewer reads after startup.
 */
async function resolveRepositoryFile(
  root: RepositoryRoot,
  relPath: string,
): Promise<string | undefined> {
  let real: string;
  try {
    real = await realpath(path.join(root.rootDir, ...relPath.split("/")));
  } catch {
    return undefined;
  }
  const relativeToRoot = path.relative(root.rootRealPath, real);
  if (
    relativeToRoot === "" ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return undefined;
  }
  const stats = await stat(real).catch(() => undefined);
  return stats?.isFile() === true ? real : undefined;
}

async function readRepositoryFile(
  root: RepositoryRoot,
  relPath: string,
): Promise<string | undefined> {
  const absolutePath = await resolveRepositoryFile(root, relPath);
  if (absolutePath === undefined) {
    return undefined;
  }
  return readFile(absolutePath, "utf8").catch(() => undefined);
}

// A change to the config or to any `.gitignore` can move files in or out of the corpus.
function isCorpusControlFile(
  relPath: string,
  configPath: string | undefined,
  rootDir: string,
): boolean {
  const name = relPath.split("/").pop() ?? "";
  if (name === ".gitignore" || name === CONFIG_FILE_NAME) {
    return true;
  }
  return (
    configPath !== undefined &&
    path.relative(rootDir, configPath).split(path.sep).join("/") === relPath
  );
}
