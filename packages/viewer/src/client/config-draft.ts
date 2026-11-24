import type { Edit } from "./config-types.js";

// Unsaved work, kept across a reload — live reload refreshes the page whenever a document is added
// or removed, and losing a half-made config change to that would be a trap. It is restored only
// onto the same version of the file it was made to, which `base`, the file's hash, identifies.
const DRAFT_KEY = "wastech-mdlint-viewer:config-draft";
// A draft made to a version of the file that is no longer on disk — a pull, a checkout or an
// editor's format-on-save changed it meanwhile. It cannot be restored as it stands, and dropping it
// would lose the reader's work without a word, so it is kept apart from the current draft, offered
// back until the reader applies or discards it, and never overwritten by the change they make next.
const SET_ASIDE_KEY = "wastech-mdlint-viewer:config-draft-set-aside";

export type Draft = {
  // The hash of the file's text the change was made to.
  base: string;
  // The text the edits apply to: the file's own text, until the reader changes the text itself.
  text: string;
  edits: Edit[];
  mode: "form" | "text";
  // Whether `text` is the reader's and not the base file's. Once the file has changed, its old text
  // is gone, and this is what still tells a change made in the form — edits that can be replayed onto
  // the new text — from a text the reader wrote, which has to replace it.
  textEdited: boolean;
  // The whole changed file, as the server last built it from `text` and `edits`, when its answer was
  // about exactly this change. Only the server can apply edits to text, so without it a change with
  // edits has no text that could be copied.
  full?: string;
  // Set while a save of this change is on its way: the text sent, and whether the reader changed
  // anything since. The server tells every page to reload once the file is written, which can land
  // before the save's own answer; this is how the reloaded page knows the file it reads is the one
  // this draft saved, and not one another program wrote.
  saving?: { text: string; edited: boolean };
};

/** The config file a draft is checked against: its text and that text's hash. */
export type FileVersion = { text: string; hash: string };

/**
 * A stored value as a draft, or `undefined` when it is not one. Storage is written by this page
 * alone, under keys only it uses, but also by older versions of the viewer and by hand; a value that
 * does not have a draft's shape would break the editor rather than restore anything.
 */
export function parseDraft(value: unknown): Draft | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const draft = value as Partial<Record<keyof Draft, unknown>>;
  if (
    typeof draft.base !== "string" ||
    typeof draft.text !== "string" ||
    !Array.isArray(draft.edits) ||
    !draft.edits.every(isEdit) ||
    (draft.mode !== "form" && draft.mode !== "text") ||
    (draft.full !== undefined && typeof draft.full !== "string") ||
    (draft.saving !== undefined && !isSaving(draft.saving))
  ) {
    return undefined;
  }
  return {
    base: draft.base,
    text: draft.text,
    edits: draft.edits,
    mode: draft.mode,
    // A draft without it was written before it was kept. Taking its text for the reader's own errs
    // towards keeping that text, where the other answer would drop it for the file's new one.
    textEdited: typeof draft.textEdited === "boolean" ? draft.textEdited : true,
    full: draft.full,
    saving: draft.saving,
  };
}

function isEdit(value: unknown): value is Edit {
  return (
    typeof value === "object" &&
    value !== null &&
    ["set", "remove", "insert"].includes((value as Edit).op) &&
    Array.isArray((value as Edit).path)
  );
}

function isSaving(value: unknown): value is Draft["saving"] {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { text: unknown }).text === "string" &&
    typeof (value as { edited: unknown }).edited === "boolean"
  );
}

/**
 * The changed file's whole text, for copying or downloading: the text itself when no form edit is
 * left to apply to it, the server's last answer when there is, or `undefined` when there is none.
 */
export function draftText(draft: Draft): string | undefined {
  return draft.edits.length === 0 ? draft.text : draft.full;
}

/**
 * What is left of a draft once its save has written `saved`: nothing, when the reader changed
 * nothing while the save was on its way, or the change they made meanwhile, now based on the saved
 * file. Its text and edits are kept as they are — applied to the text they were made to, they give
 * the saved text plus the later change — so restoring it shows the whole later change.
 */
export function afterSave(draft: Draft, saved: FileVersion): Draft | undefined {
  if (
    draft.saving?.edited !== true ||
    (draft.edits.length === 0 && draft.text === saved.text)
  ) {
    return undefined;
  }
  return {
    base: saved.hash,
    text: draft.text,
    edits: draft.edits,
    mode: draft.mode,
    textEdited: draft.text !== saved.text,
    full: draft.full,
  };
}

/**
 * What to do with the stored drafts once the page has read the config file:
 *
 * - `restore`: the draft to put back into the editor, made to this version of the file.
 * - `setAside`: a draft made to another version, to offer back to the reader.
 *
 * A draft whose save wrote the file the page now reads is not stale: the reload that save started
 * reached the page before the save's answer did, and the draft becomes whatever the reader changed
 * after saving. Any other draft for another version is set aside, replacing an older one set aside
 * before — that one the reader was already shown, and went on to make a new change instead.
 */
export function planDrafts(
  stored: Draft | undefined,
  setAside: Draft | undefined,
  file: FileVersion,
): { restore: Draft | undefined; setAside: Draft | undefined } {
  let restore: Draft | undefined;
  let aside = setAside;
  if (stored !== undefined) {
    if (stored.base === file.hash) {
      // A save still marked was never written: the file is still the version the draft was made to.
      restore = { ...stored, saving: undefined };
    } else if (stored.saving?.text === file.text) {
      restore = afterSave(stored, file);
    } else {
      aside = stored;
    }
  }
  // The file can come back to the version a set-aside draft was made to — a checkout undone — and
  // the draft then applies as it stands.
  if (restore === undefined && aside?.base === file.hash) {
    restore = aside;
    aside = undefined;
  }
  return { restore, setAside: aside };
}

/**
 * A set-aside draft, made to apply to the current file: a change made in the form replays its edits
 * onto the current text, as they name values by their place in the config, not by line; a text the
 * reader wrote replaces the current one, and the preview then shows what that does.
 */
export function rebaseDraft(draft: Draft, file: FileVersion): Draft {
  if (!draft.textEdited) {
    return {
      base: file.hash,
      text: file.text,
      edits: draft.edits,
      mode: draft.mode,
      textEdited: false,
    };
  }
  // Folded into one text where the server already did it; otherwise the edits ride along on the
  // reader's text, and the first preview folds them as it does for any restored draft.
  const text = draftText(draft);
  return text === undefined
    ? {
        base: file.hash,
        text: draft.text,
        edits: draft.edits,
        mode: draft.mode,
        textEdited: draft.text !== file.text,
        full: draft.full,
      }
    : {
        base: file.hash,
        text,
        edits: [],
        mode: draft.mode,
        textEdited: text !== file.text,
      };
}

/**
 * Keeps the draft, or forgets it when there is nothing unsaved; `false` when storage refused, for a
 * caller about to reload the page and count on finding it there.
 */
export function storeDraft(draft: Draft | undefined): boolean {
  return store(DRAFT_KEY, draft);
}

export function clearDraft(): void {
  store(DRAFT_KEY, undefined);
}

export function readDraft(): Draft | undefined {
  return read(DRAFT_KEY);
}

export function storeSetAside(draft: Draft | undefined): void {
  store(SET_ASIDE_KEY, draft);
}

export function readSetAside(): Draft | undefined {
  return read(SET_ASIDE_KEY);
}

// Storage can be unavailable (private windows, blocked site data) or full. A reload then loses the
// draft, as it would without this; nothing else depends on it.
function store(key: string, draft: Draft | undefined): boolean {
  try {
    if (draft === undefined) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, JSON.stringify(draft));
    }
    return true;
  } catch {
    return false;
  }
}

function read(key: string): Draft | undefined {
  try {
    return parseDraft(JSON.parse(sessionStorage.getItem(key) ?? "null"));
  } catch {
    return undefined;
  }
}
