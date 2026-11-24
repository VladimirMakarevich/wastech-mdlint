import type { Edit } from "./config-types.js";

// Unsaved work, kept across a reload — live reload refreshes the page whenever a document is added
// or removed, and losing a half-made config change to that would be a trap. It is restored only
// onto the same version of the file it was made to, which `base`, the file's hash, identifies.
const DRAFT_KEY = "wastech-mdlint-viewer:config-draft";

export type Draft = {
  base: string;
  text: string;
  edits: Edit[];
  mode: "form" | "text";
};

/** Keeps the draft, or forgets it when there is nothing unsaved. */
export function storeDraft(draft: Draft | undefined): void {
  try {
    if (draft === undefined) {
      sessionStorage.removeItem(DRAFT_KEY);
    } else {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }
  } catch {
    // Storage is unavailable; a reload loses the draft, as it would without this.
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing was stored.
  }
}

export function readDraft(): Draft | undefined {
  try {
    const stored: unknown = JSON.parse(
      sessionStorage.getItem(DRAFT_KEY) ?? "null",
    );
    // Written by this page alone, under a key only it uses; the caller's hash check decides whether
    // it still applies.
    return (stored ?? undefined) as Draft | undefined;
  } catch {
    return undefined;
  }
}
