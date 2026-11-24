import { afterEach, describe, expect, it, vi } from "vitest";

import {
  afterSave,
  type Draft,
  draftText,
  parseDraft,
  planDrafts,
  readDraft,
  readSetAside,
  rebaseDraft,
  storeDraft,
  storeSetAside,
} from "../src/client/config-draft.js";

const OLD = { text: '{ "rules": [] }', hash: "old" };
const NEW = { text: '{ "rules": [], "include": ["docs/**"] }', hash: "new" };

const SEVERITY_EDIT = {
  op: "set" as const,
  path: ["rules", 0, "severity"],
  value: "warning",
};

// A change made in the form: the base file's text, with edits the server applies to it.
const formDraft: Draft = {
  base: OLD.hash,
  text: OLD.text,
  edits: [SEVERITY_EDIT],
  mode: "form",
  textEdited: false,
  full: '{ "rules": [{ "severity": "warning" }] }',
};

// A change made in the text view: the reader's own text, no edits.
const textDraft: Draft = {
  base: OLD.hash,
  text: '{ "rules": [], "exclude": ["drafts/**"] }',
  edits: [],
  mode: "text",
  textEdited: true,
};

describe("parseDraft", () => {
  it("reads back a stored draft", () => {
    expect(parseDraft(JSON.parse(JSON.stringify(formDraft)))).toEqual(
      formDraft,
    );
  });

  // Storage outlives a version of the viewer and can be edited by hand; anything without a draft's
  // shape is no draft, rather than an editor broken on restoring it.
  it.each([
    null,
    "draft",
    { ...formDraft, base: 1 },
    { ...formDraft, edits: "set" },
    { ...formDraft, edits: [{ op: "rename", path: [] }] },
    { ...formDraft, mode: "split" },
    { ...formDraft, full: 3 },
    { ...formDraft, saving: { text: "x" } },
  ])("refuses %j", (value) => {
    expect(parseDraft(value)).toBeUndefined();
  });

  // A draft from before the viewer kept `textEdited`: its text is taken as the reader's, so applying
  // it can never swap it for the file's new text and lose it.
  it("takes the text of a draft that does not say whose it is as the reader's", () => {
    const older: Partial<Draft> = { ...textDraft, textEdited: false };
    delete older.textEdited;
    expect(parseDraft(older)?.textEdited).toBe(true);
  });
});

describe("draftText", () => {
  it("is the text itself when no form edit is left to apply", () => {
    expect(draftText(textDraft)).toBe(textDraft.text);
  });

  it("is the server's last text for a change with edits", () => {
    expect(draftText(formDraft)).toBe(formDraft.full);
  });

  // Only the server applies edits to text; the base text alone would be the file without the change.
  it("is nothing for a change with edits the server has not built yet", () => {
    expect(draftText({ ...formDraft, full: undefined })).toBeUndefined();
  });
});

describe("afterSave", () => {
  const savedText = formDraft.full!;
  const saved = { text: savedText, hash: "saved" };

  it("drops a draft the reader did not change while it was being saved", () => {
    expect(
      afterSave(
        { ...formDraft, saving: { text: savedText, edited: false } },
        saved,
      ),
    ).toBeUndefined();
  });

  it("drops a draft changed and changed back to exactly what was saved", () => {
    expect(
      afterSave(
        {
          ...textDraft,
          text: savedText,
          saving: { text: savedText, edited: true },
        },
        saved,
      ),
    ).toBeUndefined();
  });

  // The defect this guards: a field changed while the save was on its way was dropped with the draft,
  // and the reload that follows every save then lost it for good.
  it("keeps a change made while the save was on its way, made to the saved file", () => {
    const later = {
      ...formDraft,
      edits: [
        SEVERITY_EDIT,
        { op: "set" as const, path: ["include"], value: ["**/*.md"] },
      ],
      full: undefined,
      saving: { text: savedText, edited: true },
    };
    expect(afterSave(later, saved)).toEqual({
      base: "saved",
      text: later.text,
      edits: later.edits,
      mode: "form",
      // Its edits are still to be applied to the text they were made to, which is not the saved
      // file's: restoring folds them into it, giving the saved text plus the later change.
      textEdited: true,
      full: undefined,
    });
  });

  // The defect this guards: the kept form change came back as text — the text from before the save —
  // so once the file changed again and the draft was set aside and applied, it replaced the newer
  // file with that older text plus the edits, undoing what another program wrote.
  it("keeps a form change a form change: the saved text, with only the edits made after it", () => {
    const include = {
      op: "set" as const,
      path: ["include"],
      value: ["**/*.md"],
    };
    const later = {
      ...formDraft,
      edits: [SEVERITY_EDIT, include],
      full: undefined,
      saving: { text: savedText, edited: true, edits: [SEVERITY_EDIT] },
    };
    const kept = afterSave(later, saved);
    expect(kept).toEqual({
      base: "saved",
      text: savedText,
      edits: [include],
      mode: "form",
      textEdited: false,
      full: undefined,
    });

    // Another program then changes the file: the draft replays its one later edit onto that text.
    const newer = {
      text: '{ "rules": [], "exclude": ["x/**"] }',
      hash: "newer",
    };
    expect(rebaseDraft(kept!, newer)).toEqual({
      base: "newer",
      text: newer.text,
      edits: [include],
      mode: "form",
      textEdited: false,
    });
  });

  // The defect this guards: the same field changed again during the save rewrote the saved edit in
  // place, and splitting by count then dropped it as saved, losing the reader's later value.
  it("keeps every edit when a saved one was changed in place after the save began", () => {
    const changedAgain = { ...SEVERITY_EDIT, value: "off" };
    const draft = {
      ...formDraft,
      edits: [changedAgain],
      full: undefined,
      saving: { text: savedText, edited: true, edits: [SEVERITY_EDIT] },
    };
    expect(afterSave(draft, saved)).toEqual({
      base: "saved",
      text: formDraft.text,
      edits: [changedAgain],
      mode: "form",
      textEdited: true,
      full: undefined,
    });
  });

  it("drops nothing that was never being saved", () => {
    expect(afterSave(formDraft, saved)).toBeUndefined();
  });
});

describe("planDrafts", () => {
  it("restores a draft made to the file on disk", () => {
    expect(planDrafts(textDraft, undefined, OLD)).toEqual({
      restore: textDraft,
      setAside: undefined,
    });
  });

  // The defect this guards: a draft made to a file that changed on disk meanwhile was skipped
  // without a word, and the reader's change vanished at the next reload.
  it("sets aside a draft made to a version of the file no longer on disk", () => {
    expect(planDrafts(textDraft, undefined, NEW)).toEqual({
      restore: undefined,
      setAside: textDraft,
    });
  });

  it("keeps a set-aside draft while the reader works on a new change", () => {
    const current = { ...formDraft, base: NEW.hash };
    expect(planDrafts(current, textDraft, NEW)).toEqual({
      restore: current,
      setAside: textDraft,
    });
  });

  it("restores a set-aside draft once the file is back at its version", () => {
    expect(planDrafts(undefined, textDraft, OLD)).toEqual({
      restore: textDraft,
      setAside: undefined,
    });
  });

  // The server tells every page to reload once the file is written, which can come before the
  // save's answer: the file then on disk is the draft's own save, not someone else's change.
  it("takes a file its own save wrote as saved, not as changed under it", () => {
    const saving = { ...textDraft, saving: { text: NEW.text, edited: false } };
    expect(planDrafts(saving, undefined, NEW)).toEqual({
      restore: undefined,
      setAside: undefined,
    });
  });

  it("keeps what was changed after that save, made to the saved file", () => {
    const saving = {
      ...textDraft,
      text: '{ "rules": [], "include": ["guide/**"] }',
      saving: { text: NEW.text, edited: true },
    };
    expect(planDrafts(saving, undefined, NEW).restore).toMatchObject({
      base: NEW.hash,
      text: saving.text,
      textEdited: true,
    });
  });

  it("restores a draft whose save never wrote the file, without its save", () => {
    const saving = { ...textDraft, saving: { text: NEW.text, edited: false } };
    expect(planDrafts(saving, undefined, OLD).restore).toEqual({
      ...textDraft,
      saving: undefined,
    });
  });
});

describe("rebaseDraft", () => {
  // Form edits name values by their place in the config, so they still mean the same on the new text.
  it("replays a form change onto the current file's text", () => {
    expect(rebaseDraft(formDraft, NEW)).toEqual({
      base: NEW.hash,
      text: NEW.text,
      edits: formDraft.edits,
      mode: "form",
      textEdited: false,
    });
  });

  it("puts a text the reader wrote in place of the current one", () => {
    expect(rebaseDraft(textDraft, NEW)).toEqual({
      base: NEW.hash,
      text: textDraft.text,
      edits: [],
      mode: "text",
      textEdited: true,
    });
  });

  it("keeps edits made on top of the reader's text for the preview to fold in", () => {
    const mixed: Draft = { ...textDraft, edits: [SEVERITY_EDIT] };
    expect(rebaseDraft(mixed, NEW)).toEqual({
      base: NEW.hash,
      text: textDraft.text,
      edits: [SEVERITY_EDIT],
      mode: "text",
      textEdited: true,
      full: undefined,
    });
  });
});

describe("draft storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the current and the set-aside draft apart", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    expect(storeDraft(formDraft)).toBe(true);
    storeSetAside(textDraft);
    expect(readDraft()).toEqual(formDraft);
    expect(readSetAside()).toEqual(textDraft);
    storeDraft(undefined);
    expect(readDraft()).toBeUndefined();
    expect(readSetAside()).toEqual(textDraft);
  });

  // Private windows and blocked site data throw on any access; the page goes on without a draft,
  // and a caller about to reload is told nothing was kept.
  it("survives storage that refuses every access", () => {
    const refuse = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: refuse,
      setItem: refuse,
      removeItem: refuse,
    });
    expect(storeDraft(formDraft)).toBe(false);
    expect(() => storeSetAside(textDraft)).not.toThrow();
    expect(readDraft()).toBeUndefined();
    expect(readSetAside()).toBeUndefined();
  });
});
