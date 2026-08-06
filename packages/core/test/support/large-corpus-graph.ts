import { buildContextGraph } from "../../src/graph/build-context-graph.js";
import type { ContextGraph } from "../../src/graph/context-graph-types.js";
import type { ParsedDocument } from "../../src/markdown/document-types.js";
import { parseDocument } from "../../src/markdown/parse-document.js";

import { largeCorpusFiles } from "./large-corpus.js";

// The graph-shaped view of the large corpus, kept separate from `large-corpus.ts` on purpose: that
// module is imported by packages/cli and packages/mcp-server and must stay free of core `src`
// imports. Only core's own suites need a `ContextGraph` in memory, so the coupling lives here.

export function largeCorpusDocuments(): Map<string, ParsedDocument> {
  const documents = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(largeCorpusFiles())) {
    documents.set(filePath, parseDocument({ path: filePath, content }));
  }
  return documents;
}

export function largeCorpusGraph(): ContextGraph {
  return buildContextGraph(largeCorpusDocuments());
}
