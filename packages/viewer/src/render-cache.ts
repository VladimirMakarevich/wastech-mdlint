import type { ParsedDocument } from "@wastech-mdlint/core";

import type { Corpus } from "./corpus.js";
import { renderDocument, type RenderedDocument } from "./render-document.js";

/** How a document's links and embeds resolve: against the corpus as it is now. */
export function resolversFor(corpus: Corpus, document: ParsedDocument) {
  return {
    resolve: (fromPath: string, target: string, isImage: boolean) =>
      corpus.resolve(fromPath, target, isImage),
    resolveEmbedded: (target: string, isImage: boolean) =>
      corpus.resolveEmbedded(document, target, isImage),
  };
}

/**
 * Documents rendered as plain pages. Keyed by the document object, which the corpus replaces whenever
 * the file changes, so an edit misses the cache without any explicit invalidation. Link targets also
 * depend on which other files exist, so a change to the set of documents starts a fresh cache
 * (`clear`), and a document the corpus reports changed without replacing it - a file it links to
 * appeared or went - is dropped from it (`forget`).
 */
export class RenderCache {
  private rendered = new WeakMap<ParsedDocument, Promise<RenderedDocument>>();

  constructor(private readonly corpus: Corpus) {}

  render(document: ParsedDocument): Promise<RenderedDocument> {
    let pending = this.rendered.get(document);
    if (pending === undefined) {
      pending = renderDocument(document, resolversFor(this.corpus, document));
      this.rendered.set(document, pending);
      // A failed render is not cached, so fixing the file (or a transient read error) recovers.
      pending.catch(() => this.rendered.delete(document));
    }
    return pending;
  }

  forget(document: ParsedDocument): void {
    this.rendered.delete(document);
  }

  clear(): void {
    this.rendered = new WeakMap();
  }
}
