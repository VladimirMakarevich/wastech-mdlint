import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildContextGraph,
  candidateEscapesRoot,
  compareStrings,
  CONFIG_FILE_NAME,
  createScopeTester,
  filePart,
  isMarkdownFile,
  lintContext,
  loadConfiguration,
  type GraphContext,
  loadContext,
  parseDocument,
  resolveTargetCandidates,
  type ContextGraph,
  type LintResult,
  type LoadedConfiguration,
  type ParsedDocument,
  type ScopeTester,
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

// The two questions core's corpus scope answers for the viewer, one path at a time.
type Membership = {
  // Whether a path is, or would be, a corpus document: the config's own rule, `.gitignore` included
  // only where `respectGitignore` says so.
  scope: ScopeTester;
  // Whether a file may be handed out: the same `exclude`, with every `.gitignore` honored whatever the
  // config lints. A `.gitignore` names what the repository does not share — a local `.env`, build
  // output — and a document linking to such a file does not make it shareable, least of all with a
  // reader on another machine reaching a viewer bound with `--host`.
  servable: ScopeTester;
};

// What one document points at: every repository path its local link targets could mean, and those of
// them the viewer serves as files.
type DocumentLinks = {
  // Every candidate, whether or not anything is there yet, so a file that appears or disappears at one
  // of them later can be traced back to the documents whose pages it changes.
  targets: Set<string>;
  files: Set<string>;
};

type CorpusState = {
  loaded: LoadedConfiguration;
  documents: Map<string, ParsedDocument>;
  graph: ContextGraph;
  // Per document, its Markdown links and images. The files here, with the ones `embedded` records, are
  // the whole set `/file/` serves: a path is reachable only because a document in the corpus points
  // at it, so a request cannot read an arbitrary file just by naming it.
  links: Map<string, DocumentLinks>;
} & Membership;

// Names a directory link falls through to, in the order GitHub picks them for a folder view.
const DIRECTORY_INDEX_NAMES = ["README.md", "readme.md", "index.md"];

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Whether a link target leaves the repository (a URL, `mailto:`, a protocol-relative `//host`). */
export function isExternalTarget(target: string): boolean {
  return SCHEME.test(target) || target.startsWith("//");
}

export class Corpus {
  // The targets of each document's raw HTML (`<img src>`, `<a href>`), which core does not read:
  // they are found while the page is rendered, from the tree of the same parse, and recorded here so
  // `/file/` serves an embedded image the page asks for next. Keyed by the document object, which the
  // corpus replaces when the file changes, so an edit drops the record with the page it came from.
  private readonly embedded = new WeakMap<ParsedDocument, DocumentLinks>();

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
   * *which* files are documents pays for a full reload, because deciding membership means re-running
   * core's include/exclude/gitignore discovery: the config or a `.gitignore`, a new Markdown file the
   * scope takes in, a folder of documents that is gone, or a folder holding new ones. A watcher
   * reports a moved or deleted folder as that one path and nothing for the files inside it, which is
   * why folders are judged here at all.
   *
   * A path documents link to — an image that has just been saved, a file deleted — changes those
   * documents' pages without changing the documents, so they are reported as changed too.
   *
   * `structural` reports that the set of documents may have changed, which every open page needs to
   * know because each one shows the document tree.
   */
  async applyChanges(
    paths: readonly string[],
  ): Promise<{ changed: string[]; structural: boolean }> {
    const state = this.state;
    const edited = paths.filter((changedPath) =>
      state.documents.has(changedPath),
    );
    const others = paths.filter(
      (changedPath) => !state.documents.has(changedPath),
    );
    if (await this.changesMembership(others)) {
      await this.reload();
      return { changed: [...paths].sort(compareStrings), structural: true };
    }

    const documents = new Map(state.documents);
    const changed = new Set<string>();
    let structural = false;
    for (const changedPath of edited) {
      const previous = documents.get(changedPath)!;
      const content = await readRepositoryFile(this.root, changedPath);
      if (content === undefined) {
        documents.delete(changedPath);
        structural = true;
        changed.add(changedPath);
      } else if (content !== previous.content) {
        documents.set(
          changedPath,
          parseDocument({ path: changedPath, content }),
        );
        changed.add(changedPath);
      }
    }
    const documentsChanged = changed.size > 0;
    const relinked = await this.documentsReachingChangedFiles(others);
    if (!documentsChanged && relinked.size === 0) {
      return { changed: [], structural };
    }

    // Links resolve against the whole document set, so they are recomputed only once every changed
    // document is in the map.
    const links = new Map(state.links);
    for (const documentPath of new Set([...changed, ...relinked])) {
      const document = documents.get(documentPath);
      if (document === undefined) {
        links.delete(documentPath);
        continue;
      }
      links.set(
        documentPath,
        await collectLinks(
          this.root,
          document,
          documents,
          state.loaded.settings.siteRouter,
          state,
        ),
      );
      // Its raw HTML is resolved again when the page is next rendered.
      this.embedded.delete(document);
      changed.add(documentPath);
    }
    this.state = {
      ...state,
      documents,
      // The graph is built from the documents alone; a file appearing beside them changes no edge,
      // and keeping the same object keeps everything cached against it.
      graph: documentsChanged
        ? buildContextGraph(documents, {
            siteRouter: state.loaded.settings.siteRouter,
            idRef: state.loaded.settings.idRef,
          })
        : state.graph,
      links,
    };
    return { changed: [...changed].sort(compareStrings), structural };
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
    const { documents, links, loaded } = this.state;
    const linked = links.get(fromPath)?.files;
    for (const candidate of safeCandidates(
      fromPath,
      target,
      isImage,
      loaded.settings.siteRouter,
    )) {
      const page = documentAt(candidate, documents);
      if (page !== undefined) {
        return page;
      }
      if (linked?.has(candidate) === true) {
        return { kind: "file", path: candidate };
      }
    }
    return { kind: "missing" };
  }

  /**
   * Where a target in a document's raw HTML points, by the same candidates as `resolve`, checking on
   * disk whether a file there may be served. A file it finds is recorded against the document, which
   * is what lets `/file/` serve it: core reads no raw HTML, so these targets are not among the links
   * collected when the corpus loads.
   */
  async resolveEmbedded(
    document: ParsedDocument,
    target: string,
    isImage: boolean,
  ): Promise<ResolvedTarget> {
    const state = this.state;
    let record = this.embedded.get(document);
    if (record === undefined) {
      record = { targets: new Set(), files: new Set() };
      this.embedded.set(document, record);
    }
    const candidates = safeCandidates(
      document.path,
      target,
      isImage,
      state.loaded.settings.siteRouter,
    );
    for (const candidate of candidates) {
      record.targets.add(candidate);
    }
    for (const candidate of candidates) {
      const page = documentAt(candidate, state.documents);
      if (page !== undefined) {
        return page;
      }
      if (await servableFile(this.root, state, candidate)) {
        record.files.add(candidate);
        return { kind: "file", path: candidate };
      }
    }
    return { kind: "missing" };
  }

  isLinkedFile(relPath: string): boolean {
    for (const links of this.state.links.values()) {
      if (links.files.has(relPath)) {
        return true;
      }
    }
    for (const document of this.state.documents.values()) {
      if (this.embedded.get(document)?.files.has(relPath) === true) {
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

  /**
   * Lint the corpus a candidate configuration would produce, without adopting it.
   *
   * Parsing a document does not depend on the config, so only what the candidate changes is redone:
   * new rules lint the documents already parsed, in a fraction of a second; new link settings
   * (`siteRouter`, `idRef`) rebuild the graph over them; and only a new `include`, `exclude` or
   * `respectGitignore` pays for core's discovery and a parse of the corpus that scope selects,
   * because that is the one change that decides which files are documents.
   */
  async lintCandidate(
    candidate: LoadedConfiguration,
  ): Promise<{ result: LintResult; documentCount: number }> {
    const { loaded, documents, graph } = this.state;
    let context: GraphContext;
    if (!sameValues(scopeOf(loaded), scopeOf(candidate))) {
      context = await loadContext({
        cwd: this.root.rootDir,
        config: candidate.config,
        settings: candidate.settings,
      });
    } else if (
      !sameValues(graphSettingsOf(loaded), graphSettingsOf(candidate))
    ) {
      context = {
        documents,
        graph: buildContextGraph(documents, {
          siteRouter: candidate.settings.siteRouter,
          idRef: candidate.settings.idRef,
        }),
      };
    } else {
      context = { documents, graph };
    }
    return {
      result: lintContext({
        cwd: this.root.rootDir,
        context,
        rules: candidate.rules,
        settings: candidate.settings,
      }),
      documentCount: context.documents.size,
    };
  }

  /** Whether an absolute path is, through any symlinks, inside the repository. */
  async contains(absolutePath: string): Promise<boolean> {
    const real = await realpath(absolutePath).catch(() => undefined);
    if (real === undefined) {
      return false;
    }
    const relativeToRoot = path.relative(this.root.rootRealPath, real);
    return !(
      relativeToRoot === "" ||
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot)
    );
  }

  /**
   * Whether any of `paths`, none of them a document, can change which files are documents.
   *
   * Every judgment is core's scope: a Markdown path `include` takes in and nothing excludes, and a
   * folder no `exclude` or `.gitignore` prunes. A folder event alone says little — some platforms
   * report a folder whenever a file inside it is created — so a folder that still exists counts only
   * when it holds a document the corpus lacks, and one that is gone only when documents lived in it.
   */
  private async changesMembership(paths: readonly string[]): Promise<boolean> {
    if (paths.length === 0) {
      return false;
    }
    const { loaded, documents, scope } = this.state;
    const documentFolders = foldersOf(documents.keys());
    for (const changedPath of paths) {
      if (
        isCorpusControlFile(changedPath, loaded.configPath, this.root.rootDir)
      ) {
        return true;
      }
      if (documentFolders.has(changedPath)) {
        if ((await this.statOf(changedPath)) === undefined) {
          return true;
        }
        continue;
      }
      if (scope.includes(changedPath)) {
        if (!(await scope.excludes(changedPath, false))) {
          return true;
        }
        continue;
      }
      // Pruned paths are dropped before touching the disk: a build writing thousands of files into an
      // excluded folder costs a pattern match each, not a `stat`.
      if (await scope.excludes(changedPath, true)) {
        continue;
      }
      if (
        (await this.statOf(changedPath))?.isDirectory() === true &&
        (await this.holdsNewDocuments(changedPath))
      ) {
        return true;
      }
    }
    return false;
  }

  // Whether a folder holds, at any depth core would walk, a Markdown file the scope takes in that is
  // not a document yet. Stops at the first one, and never descends into a pruned folder.
  private async holdsNewDocuments(relDirectory: string): Promise<boolean> {
    const { documents, scope } = this.state;
    let entries: Dirent[];
    try {
      entries = await readdir(this.absolute(relDirectory), {
        withFileTypes: true,
      });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const child = `${relDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (
          !(await scope.excludes(child, true)) &&
          (await this.holdsNewDocuments(child))
        ) {
          return true;
        }
      } else if (
        scope.includes(child) &&
        !documents.has(child) &&
        !(await scope.excludes(child, false))
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * The documents whose pages change because a file appeared or disappeared at one of `paths`, or
   * under one of them when it names a folder: those with a link target there whose answer to "may
   * this file be served?" is no longer the one recorded.
   */
  private async documentsReachingChangedFiles(
    paths: readonly string[],
  ): Promise<Set<string>> {
    const affected = new Set<string>();
    if (paths.length === 0) {
      return affected;
    }
    const state = this.state;
    // Every target under each of its folders too, so one lookup per changed path finds the targets
    // at it and below it; a batch can hold thousands of paths a build wrote.
    const byPath = new Map<
      string,
      { documentPath: string; record: DocumentLinks; target: string }[]
    >();
    const index = (documentPath: string, record: DocumentLinks): void => {
      for (const target of record.targets) {
        const segments = target.split("/");
        for (let end = segments.length; end >= 1; end -= 1) {
          const key = segments.slice(0, end).join("/");
          const entries = byPath.get(key) ?? [];
          entries.push({ documentPath, record, target });
          byPath.set(key, entries);
        }
      }
    };
    for (const [documentPath, record] of state.links) {
      index(documentPath, record);
    }
    for (const document of state.documents.values()) {
      const record = this.embedded.get(document);
      if (record !== undefined) {
        index(document.path, record);
      }
    }
    const servable = new Map<string, boolean>();
    for (const changedPath of paths) {
      for (const { documentPath, record, target } of byPath.get(changedPath) ??
        []) {
        if (affected.has(documentPath)) {
          continue;
        }
        let now = servable.get(target);
        if (now === undefined) {
          now = await servableFile(this.root, state, target);
          servable.set(target, now);
        }
        if (now !== record.files.has(target)) {
          affected.add(documentPath);
        }
      }
    }
    return affected;
  }

  private absolute(relPath: string): string {
    return path.join(this.root.rootDir, ...relPath.split("/"));
  }

  private statOf(relPath: string): Promise<Stats | undefined> {
    return stat(this.absolute(relPath)).catch(() => undefined);
  }
}

function scopeOf(loaded: LoadedConfiguration): unknown[] {
  const { include, exclude, respectGitignore } = loaded.config;
  return [include, exclude, respectGitignore];
}

function graphSettingsOf(loaded: LoadedConfiguration): unknown[] {
  return [loaded.settings.siteRouter, loaded.settings.idRef];
}

// Both sides come from the same JSON config through the same schema, so equal values serialize to
// equal text; a difference in key order only costs a rebuild that was not needed.
function sameValues(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const membership: Membership = {
    scope: createScopeTester({ cwd: root.rootDir, config: loaded.config }),
    servable: createScopeTester({
      cwd: root.rootDir,
      config: loaded.config,
      respectGitignore: true,
    }),
  };
  // Documents are checked concurrently: each check is a few filesystem round trips, and awaiting them
  // one document at a time added seconds to startup on a corpus of a few hundred documents.
  // `Promise.all` keeps the input order, so the map's order stays the corpus order.
  const links = new Map(
    await Promise.all(
      [...documents.values()].map(
        async (document) =>
          [
            document.path,
            await collectLinks(
              root,
              document,
              documents,
              loaded.settings.siteRouter,
              membership,
            ),
          ] as const,
      ),
    ),
  );
  return { loaded, documents, graph, links, ...membership };
}

async function collectLinks(
  root: RepositoryRoot,
  document: ParsedDocument,
  documents: ReadonlyMap<string, ParsedDocument>,
  siteRouter: SiteRouter,
  membership: Membership,
): Promise<DocumentLinks> {
  const links: DocumentLinks = { targets: new Set(), files: new Set() };
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
    const candidates = safeCandidates(
      document.path,
      target,
      isImage,
      siteRouter,
    );
    for (const candidate of candidates) {
      links.targets.add(candidate);
    }
    for (const candidate of candidates) {
      if (documentAt(candidate, documents) !== undefined) {
        break;
      }
      if (await servableFile(root, membership, candidate)) {
        links.files.add(candidate);
        break;
      }
    }
  }
  return links;
}

/**
 * Whether the viewer may hand out the repository file at `relPath` as a linked file: it is there, it
 * is not Markdown — a Markdown file outside the corpus is one the config keeps out of the viewer
 * exactly as it keeps it out of a lint run — and no `exclude` pattern or `.gitignore` covers it.
 */
async function servableFile(
  root: RepositoryRoot,
  membership: Membership,
  relPath: string,
): Promise<boolean> {
  if (isMarkdownFile(relPath) || membership.scope.includes(relPath)) {
    return false;
  }
  if (await membership.servable.excludes(relPath, false)) {
    return false;
  }
  return (await resolveRepositoryFile(root, relPath)) !== undefined;
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

// The document a candidate names, directly or as the README of the folder it names.
function documentAt(
  candidate: string,
  documents: ReadonlyMap<string, ParsedDocument>,
): ResolvedTarget | undefined {
  if (documents.has(candidate)) {
    return { kind: "document", path: candidate };
  }
  const directory = candidate.replace(/\/+$/, "");
  for (const name of DIRECTORY_INDEX_NAMES) {
    const indexPath =
      directory === "" || directory === "." ? name : `${directory}/${name}`;
    if (documents.has(indexPath)) {
      return { kind: "document", path: indexPath };
    }
  }
  return undefined;
}

// Every folder that holds a document, directly or further down.
function foldersOf(paths: Iterable<string>): Set<string> {
  const folders = new Set<string>();
  for (const relPath of paths) {
    const segments = relPath.split("/");
    for (let end = 1; end < segments.length; end += 1) {
      folders.add(segments.slice(0, end).join("/"));
    }
  }
  return folders;
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
