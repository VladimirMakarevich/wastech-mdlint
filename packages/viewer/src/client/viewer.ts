import { initDiagnostics } from "./diagnostics.js";
import { initDiagrams } from "./diagrams.js";
import { initLiveReload } from "./live-reload.js";
import { initSearch } from "./search.js";
import { initSourceLines } from "./source-lines.js";
import { initThemeToggle } from "./theme-toggle.js";

// The page works without these scripts: documents, links, the tree, highlighted code and search
// (as a results page) are all server-rendered. Each module adds one thing that needs a browser, and
// nothing on the page depends on any of them having run.

// Set only on a document page; a source-file page or a results page has no document of its own.
const documentPath =
  document.querySelector<HTMLMetaElement>('meta[name="wastech-doc"]')
    ?.content ?? undefined;

initThemeToggle();
initLiveReload(documentPath);
initSourceLines();
initDiagrams();
initSearch();
initDiagnostics(documentPath);
