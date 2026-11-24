import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  compareStrings,
  normalizeText,
  writeFileAtomic,
} from "@wastech-mdlint/core";

// What a reader has reviewed, kept per clone outside the work tree, so it survives restarts, a
// viewer on another port and a switch of branch. A mark is keyed by content, not by commit or time:
// a document stays reviewed while its text is the text that was marked, whatever branch, rebase or
// force-push brought it there, and turns "changed since review" the moment it differs.
//
// On disk, in the clone's own folder of the state directory:
//   review.json        the index: per path, the hashes of the texts reviewed there, newest first,
//                      and per path and section the hashes of the sections' own texts
//   review.lock        present only while a viewer is writing
//   texts/<hash>.md    each reviewed text, once, for the diff "since my last review"
// The texts are kept because the version a reader reviewed may never have been committed, so git
// cannot give it back. Markdown is small, and a text no mark refers to is dropped on the next write.

/** Where a changed document stands against the reader's marks. Computed on every read, never stored. */
export type ReviewStatus = "unreviewed" | "reviewed" | "changed";

/**
 * The hash a mark is kept under: SHA-256 of the text as core normalizes it for a diff, not git's
 * blob id. Uncommitted text has no blob, and with `core.autocrlf` the blob and the file on disk differ
 * by every line ending although a reader sees the same document.
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text), "utf8").digest("hex");
}

// A deleted document's text. Its mark says "this deletion was reviewed" about one path only: looked
// up by content like any other, one reviewed deletion would mark every deleted document reviewed.
const EMPTY_HASH = contentHash("");

const HASH = /^[0-9a-f]{64}$/;
const TEXT_FILE = /^([0-9a-f]{64})\.md$/;
// Format 2 added per-section marks. A file of format 1 has none and is read as it is; a viewer that
// knew only format 1 refuses a file of format 2 rather than writing it back without its sections.
const FORMAT = 2;

// How many reviewed versions a path remembers. More than one, so switching back to a branch whose
// text was reviewed before finds it reviewed although another version was reviewed in between; a
// few, so a document reviewed on many branches over months does not keep every text it ever had.
const VERSIONS_PER_PATH = 10;

// A write holds the lock for milliseconds. One older than this was left by a viewer that died while
// writing, and is taken over rather than blocking every mark until someone deletes it by hand.
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_WAIT_MS = 3_000;

/** One section of a document as a page shows it: its key and the hash of its own text. */
export type SectionHash = { key: string; hash: string };

/** Per path, per section key, the hashes of the section texts reviewed there, newest first. */
export type SectionMarks = Map<string, Map<string, string[]>>;

/** The marks as one read of the index found them, with the questions the pages ask of them. */
export class ReviewMarks {
  // Every reviewed text but the empty one, for finding a document reviewed under another path.
  private readonly hashes: ReadonlySet<string>;

  constructor(
    // Keyed by path from the work tree's top level, as the index stores them.
    readonly documents: ReadonlyMap<string, readonly string[]>,
    readonly sections: SectionMarks,
    private readonly keyOf: (relPath: string) => string,
  ) {
    this.hashes = new Set(
      [...documents.values()].flat().filter((hash) => hash !== EMPTY_HASH),
    );
  }

  /**
   * Where one section stands: reviewed while its own text is a text reviewed under its key, whatever
   * happened to the rest of the document since; changed since review when its key has marks for
   * other texts. A renamed heading has a new key, and starts unreviewed.
   */
  sectionStatus(entry: {
    path: string;
    oldPath?: string;
    key: string;
    hash: string;
  }): ReviewStatus {
    const marked = [entry.path, entry.oldPath]
      .filter((relPath): relPath is string => relPath !== undefined)
      .flatMap(
        (relPath) =>
          this.sections.get(this.keyOf(relPath))?.get(entry.key) ?? [],
      );
    return marked.includes(entry.hash)
      ? "reviewed"
      : marked.length > 0
        ? "changed"
        : "unreviewed";
  }

  /**
   * Where a document stands. Reviewed when its text was marked under its path, under the path a
   * rename took it from, or under any path at all — so a document moved without an edit, or found
   * on another branch under another name, is not reviewed twice. Changed since review when its path
   * (or the path it was renamed from) has marks for other texts; `since` is the newest of them, the
   * version to compare with.
   */
  status(entry: {
    path: string;
    oldPath?: string;
    hash: string;
    // The document's sections as it is now: when every one is reviewed, so is the document, though
    // it was never marked as a whole in this version.
    sections?: readonly SectionHash[];
  }): {
    status: ReviewStatus;
    since?: string;
  } {
    const own = this.documents.get(this.keyOf(entry.path)) ?? [];
    const old =
      entry.oldPath === undefined
        ? []
        : (this.documents.get(this.keyOf(entry.oldPath)) ?? []);
    const sections = entry.sections ?? [];
    const sectionStatuses = sections.map((section) =>
      this.sectionStatus({
        path: entry.path,
        ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
        ...section,
      }),
    );
    if (
      own.includes(entry.hash) ||
      old.includes(entry.hash) ||
      (entry.hash !== EMPTY_HASH && this.hashes.has(entry.hash)) ||
      (sections.length > 0 &&
        sectionStatuses.every((status) => status === "reviewed"))
    ) {
      return { status: "reviewed" };
    }
    const since = own[0] ?? old[0];
    if (since !== undefined) {
      return { status: "changed", since };
    }
    // Sections reviewed one at a time, the document never as a whole: started, not finished.
    return sectionStatuses.some((status) => status !== "unreviewed")
      ? { status: "changed" }
      : { status: "unreviewed" };
  }
}

/** A change to the marks, in the host root's paths; the store restates them from the top level. */
// Marking a document marks its sections as they are too, so a later edit to one section leaves the
// others reviewed; unmarking it takes back the marks of its sections as they are.
export type MarkChange =
  | {
      kind: "mark";
      path: string;
      hash: string;
      text: string;
      sections?: readonly SectionHash[];
    }
  | {
      kind: "unmark";
      path: string;
      oldPath?: string;
      hash: string;
      sections?: readonly SectionHash[];
    }
  | {
      kind: "section";
      path: string;
      oldPath?: string;
      key: string;
      hash: string;
      reviewed: boolean;
    }
  | {
      kind: "reset";
      documents: readonly { path: string; oldPath?: string; hash: string }[];
    };

export type StoreRead =
  | { ok: true; marks: ReviewMarks }
  | { ok: false; message: string };

export type WriteOutcome =
  | { ok: true; marks: ReviewMarks }
  | { ok: false; status: "failed" | "busy" | "refused"; message: string };

export type ReviewStoreOptions = {
  // The state directory: the platform's default or `--state-dir`.
  stateDir: string;
  // The realpath of the clone's common git directory, shared by all its worktrees.
  commonDir: string;
  // A host-root path restated from the work tree's top level.
  keyOf: (relPath: string) => string;
  // How long a write waits for another viewer's; shortened by a test of a lock that is never let go.
  lockWaitMs?: number;
};

export class ReviewStore {
  /** The clone's own folder. Absolute, so it is never shown on a page or in a payload. */
  readonly directory: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly textsDir: string;
  private readonly commonDir: string;
  private readonly keyOf: (relPath: string) => string;
  private readonly lockWaitMs: number;
  // Writes from this process run one at a time, so they never wait on each other's lock.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ReviewStoreOptions) {
    this.commonDir = options.commonDir;
    this.keyOf = options.keyOf;
    this.lockWaitMs = options.lockWaitMs ?? LOCK_WAIT_MS;
    this.directory = path.join(
      options.stateDir,
      cloneFolder(options.commonDir),
    );
    this.indexPath = path.join(this.directory, "review.json");
    this.lockPath = path.join(this.directory, "review.lock");
    this.textsDir = path.join(this.directory, "texts");
  }

  /**
   * The marks as they are now. Creates nothing: a clone never marked, or a state directory that does
   * not exist, simply has no marks. Read without the lock, since every write replaces the index in
   * one rename and a reader sees either the old version or the new one, whole.
   */
  async read(): Promise<StoreRead> {
    const index = await this.readIndex();
    return index.ok
      ? {
          ok: true,
          marks: new ReviewMarks(index.documents, index.sections, this.keyOf),
        }
      : index;
  }

  /** The text a mark was made on, or `undefined` when it is no longer kept. */
  async snapshot(hash: string): Promise<string | undefined> {
    if (!HASH.test(hash)) {
      return undefined;
    }
    return readFile(path.join(this.textsDir, `${hash}.md`), "utf8").catch(
      () => undefined,
    );
  }

  /**
   * Apply a change and answer the marks it left.
   *
   * Under the lock every viewer of the clone takes, the index is read again, so two viewers merge
   * their marks rather than the later write dropping the other's: marks for different documents
   * both stay, and for the same document the later one wins, both being the same reader's. A text
   * goes in before the index that refers to it, so a failure in between leaves an unreferenced text
   * at worst, which is removed again. The index is replaced in one rename: a failed write leaves the
   * previous marks whole, and is reported rather than shown as done.
   */
  update(change: MarkChange): Promise<WriteOutcome> {
    const run = this.queue.then(() => this.locked(change));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async locked(change: MarkChange): Promise<WriteOutcome> {
    try {
      // Owner-only on POSIX: the folder holds copies of the repository's documents, and a home
      // directory that others can list would otherwise let them read these too.
      await mkdir(this.textsDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      return failed(error);
    }
    const lock = await this.acquire();
    if (lock !== undefined) {
      return lock;
    }
    try {
      const index = await this.readIndex();
      if (!index.ok) {
        return { ok: false, status: "refused", message: index.message };
      }
      const documents = new Map(
        [...index.documents].map(([key, hashes]) => [key, [...hashes]]),
      );
      const sections: SectionMarks = new Map(
        [...index.sections].map(([key, marks]) => [
          key,
          new Map(
            [...marks].map(([section, hashes]) => [section, [...hashes]]),
          ),
        ]),
      );
      applyChange({ documents, sections }, change, this.keyOf);

      const created: string[] = [];
      if (change.kind === "mark") {
        const target = path.join(this.textsDir, `${change.hash}.md`);
        const exists = await stat(target).then(
          () => true,
          () => false,
        );
        if (!exists) {
          try {
            await writeFileAtomic(target, normalizeText(change.text));
          } catch (error) {
            return failed(error);
          }
          created.push(target);
        }
      }
      try {
        await writeFileAtomic(
          this.indexPath,
          serializeIndex(this.commonDir, documents, sections),
        );
      } catch (error) {
        await Promise.all(
          created.map((target) => unlink(target).catch(() => undefined)),
        );
        return failed(error);
      }
      await this.dropUnreferencedTexts(documents);
      return {
        ok: true,
        marks: new ReviewMarks(documents, sections, this.keyOf),
      };
    } finally {
      await unlink(this.lockPath).catch(() => undefined);
    }
  }

  /**
   * Take the clone's lock, or say why not. Creating the file exclusively is atomic on every local
   * filesystem the viewer runs on, so of two viewers only one gets it.
   */
  private async acquire(): Promise<WriteOutcome | undefined> {
    const deadline = Date.now() + this.lockWaitMs;
    for (;;) {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (!(await this.lockHeld(error))) {
          return failed(error);
        }
      }
      if (handle !== undefined) {
        const held = handle;
        // The process id, for a person who finds a lock left behind; nothing reads it back, so a
        // failure to write it leaves the lock just as held.
        await held
          .writeFile(`${String(process.pid)}\n`)
          .catch(() => undefined)
          .finally(() => held.close().catch(() => undefined));
        return undefined;
      }
      const age = await stat(this.lockPath).then(
        (stats) => Date.now() - stats.mtimeMs,
        () => 0,
      );
      if (age > LOCK_STALE_MS) {
        // Two viewers can both find the same stale lock and both remove it; then each tries to
        // create it again and only one succeeds, so the cost of that race is one extra retry.
        await unlink(this.lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          status: "busy",
          message:
            "Another viewer of this repository is saving review marks. Try again in a moment.",
        };
      }
      await delay(LOCK_RETRY_MS);
    }
  }

  // Whether creating the lock failed because another viewer holds it, rather than because the folder
  // cannot be written. Windows refuses to create a file that is still being deleted with an access
  // error rather than "exists", so an access error counts as held while the lock is still there.
  private async lockHeld(error: unknown): Promise<boolean> {
    const code = errnoCode(error);
    if (code === "EEXIST") {
      return true;
    }
    if (code !== "EPERM" && code !== "EACCES") {
      return false;
    }
    return stat(this.lockPath).then(
      () => true,
      (statError: unknown) => {
        const statCode = errnoCode(statError);
        return statCode === "EPERM" || statCode === "EACCES";
      },
    );
  }

  private async readIndex(): Promise<ParsedIndex> {
    let text: string;
    try {
      text = await readFile(this.indexPath, "utf8");
    } catch (error) {
      const code = errnoCode(error);
      // Nothing stored yet — or a state directory that is not a directory, where nothing can be.
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { ok: true, documents: new Map(), sections: new Map() };
      }
      return {
        ok: false,
        message: `The review marks could not be read (${code ?? "read error"}).`,
      };
    }
    return parseIndex(text);
  }

  private async dropUnreferencedTexts(
    documents: ReadonlyMap<string, readonly string[]>,
  ): Promise<void> {
    const referenced = new Set([...documents.values()].flat());
    const names = await readdir(this.textsDir).catch(() => [] as string[]);
    const unreferenced = names.filter((name) => {
      const hash = TEXT_FILE.exec(name)?.[1];
      return hash !== undefined && !referenced.has(hash);
    });
    await Promise.all(
      unreferenced.map((name) =>
        unlink(path.join(this.textsDir, name)).catch(() => undefined),
      ),
    );
  }
}

/**
 * The clone's folder name: a hash of its common git directory, so every worktree of one clone shares
 * it and a fresh clone starts empty, after the clone's own folder name, so a person looking at the
 * state directory can tell which folder to delete. Only characters every filesystem accepts.
 */
export function cloneFolder(commonDir: string): string {
  const digest = createHash("sha256")
    .update(commonDir, "utf8")
    .digest("hex")
    .slice(0, 16);
  // `.git` inside a work tree: the work tree's folder names the clone. A bare clone's own folder
  // (`name.git`) names it.
  const base = path.basename(commonDir);
  const name =
    base.toLowerCase() === ".git"
      ? path.basename(path.dirname(commonDir))
      : base.replace(/\.git$/i, "");
  const label = name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 40);
  return `${label === "" ? "repository" : label}-${digest}`;
}

function applyChange(
  state: { documents: Map<string, string[]>; sections: SectionMarks },
  change: MarkChange,
  keyOf: (relPath: string) => string,
): void {
  const { documents, sections } = state;
  const keysOf = (entry: { path: string; oldPath?: string }) =>
    [entry.path, entry.oldPath]
      .filter((relPath): relPath is string => relPath !== undefined)
      .map(keyOf);
  const markSection = (documentKey: string, section: SectionHash) => {
    let marks = sections.get(documentKey);
    if (marks === undefined) {
      marks = new Map();
      sections.set(documentKey, marks);
    }
    const hashes = marks.get(section.key) ?? [];
    marks.set(
      section.key,
      [section.hash, ...hashes.filter((hash) => hash !== section.hash)].slice(
        0,
        VERSIONS_PER_PATH,
      ),
    );
  };
  const unmarkSection = (
    documentKeys: readonly string[],
    section: SectionHash,
  ) => {
    for (const documentKey of documentKeys) {
      const marks = sections.get(documentKey);
      const hashes = marks?.get(section.key);
      if (marks !== undefined && hashes !== undefined) {
        marks.set(
          section.key,
          hashes.filter((hash) => hash !== section.hash),
        );
      }
    }
  };
  // Removing a text removes it under every path, since a text marked under one path counts under
  // all of them; the empty text of a deletion is the exception, counted under its own path only.
  const removeEverywhere = (hash: string, keys: readonly string[]) => {
    for (const [key, hashes] of documents) {
      if (hash !== EMPTY_HASH || keys.includes(key)) {
        documents.set(
          key,
          hashes.filter((entry) => entry !== hash),
        );
      }
    }
  };
  if (change.kind === "mark") {
    const key = keyOf(change.path);
    const hashes = documents.get(key) ?? [];
    documents.set(
      key,
      [change.hash, ...hashes.filter((hash) => hash !== change.hash)].slice(
        0,
        VERSIONS_PER_PATH,
      ),
    );
    for (const section of change.sections ?? []) {
      markSection(key, section);
    }
  } else if (change.kind === "unmark") {
    const keys = keysOf(change);
    removeEverywhere(change.hash, keys);
    for (const section of change.sections ?? []) {
      unmarkSection(keys, section);
    }
  } else if (change.kind === "section") {
    if (change.reviewed) {
      markSection(keyOf(change.path), change);
    } else {
      unmarkSection(keysOf(change), change);
    }
  } else {
    // Starting over: the documents forget every version reviewed under their paths, not only the
    // current one, or an older mark would leave them "changed since review" rather than unreviewed.
    for (const entry of change.documents) {
      const keys = [entry.path, entry.oldPath]
        .filter((relPath): relPath is string => relPath !== undefined)
        .map(keyOf);
      for (const key of keys) {
        documents.delete(key);
        sections.delete(key);
      }
      removeEverywhere(entry.hash, keys);
    }
  }
  for (const [key, hashes] of documents) {
    if (hashes.length === 0) {
      documents.delete(key);
    }
  }
  for (const [key, marks] of sections) {
    for (const [section, hashes] of marks) {
      if (hashes.length === 0) {
        marks.delete(section);
      }
    }
    if (marks.size === 0) {
      sections.delete(key);
    }
  }
}

// Paths in code-point order and pretty-printed, so the same marks always make the same file and a
// person reading it finds a path where they expect it.
function serializeIndex(
  repository: string,
  documents: ReadonlyMap<string, readonly string[]>,
  sections: SectionMarks,
): string {
  const sorted: Record<string, readonly string[]> = {};
  for (const key of [...documents.keys()].sort(compareStrings)) {
    sorted[key] = documents.get(key)!;
  }
  const sortedSections: Record<string, Record<string, readonly string[]>> = {};
  for (const key of [...sections.keys()].sort(compareStrings)) {
    const marks = sections.get(key)!;
    const entry: Record<string, readonly string[]> = {};
    for (const section of [...marks.keys()].sort(compareStrings)) {
      entry[section] = marks.get(section)!;
    }
    sortedSections[key] = entry;
  }
  return `${JSON.stringify(
    { format: FORMAT, repository, documents: sorted, sections: sortedSections },
    null,
    2,
  )}\n`;
}

const UNREADABLE =
  "The review marks file is not one this viewer can read, so it is left as it is. Fix it or delete it to mark documents again.";

type ParsedIndex =
  | {
      ok: true;
      documents: Map<string, readonly string[]>;
      sections: SectionMarks;
    }
  | { ok: false; message: string };

const isHashList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((hash) => typeof hash === "string" && HASH.test(hash));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseIndex(text: string): ParsedIndex {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: UNREADABLE };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, message: UNREADABLE };
  }
  const { format, documents, sections } = json as Record<string, unknown>;
  if (typeof format === "number" && format > FORMAT) {
    return {
      ok: false,
      message:
        "The review marks were saved by a newer version of the viewer, so this one leaves them as they are. Update the viewer to mark documents again.",
    };
  }
  if (
    (format !== 1 && format !== FORMAT) ||
    !isRecord(documents) ||
    (sections !== undefined && !isRecord(sections))
  ) {
    return { ok: false, message: UNREADABLE };
  }
  const parsed = new Map<string, readonly string[]>();
  for (const [key, hashes] of Object.entries(documents)) {
    if (!isHashList(hashes)) {
      return { ok: false, message: UNREADABLE };
    }
    if (hashes.length > 0) {
      parsed.set(key, hashes);
    }
  }
  const parsedSections: SectionMarks = new Map();
  for (const [key, marks] of Object.entries(sections ?? {})) {
    if (!isRecord(marks)) {
      return { ok: false, message: UNREADABLE };
    }
    const entry = new Map<string, string[]>();
    for (const [section, hashes] of Object.entries(marks)) {
      if (!isHashList(hashes)) {
        return { ok: false, message: UNREADABLE };
      }
      if (hashes.length > 0) {
        entry.set(section, hashes);
      }
    }
    if (entry.size > 0) {
      parsedSections.set(key, entry);
    }
  }
  return { ok: true, documents: parsed, sections: parsedSections };
}

function failed(error: unknown): WriteOutcome {
  return {
    ok: false,
    status: "failed",
    message: `The review mark could not be saved (${errnoCode(error) ?? "write error"}); nothing was changed.`,
  };
}

function errnoCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
