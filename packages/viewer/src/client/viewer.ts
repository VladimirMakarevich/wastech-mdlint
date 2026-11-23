import { initCharts } from "./charts.js";
import { initCodeCopy } from "./code-copy.js";
import { initColumnResize } from "./column-resize.js";
import { initConfigEditor } from "./config-editor.js";
import { initCopyPath } from "./copy-path.js";
import { initDashboard } from "./dashboard.js";
import { initDiagnostics } from "./diagnostics.js";
import { initDiagrams } from "./diagrams.js";
import { initDisplaySettings } from "./display-settings.js";
import { initGraph, initLocalGraph } from "./graph.js";
import { initLiveReload } from "./live-reload.js";
import { initOpenConfig } from "./open-config.js";
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
initDisplaySettings();
initCopyPath();
initColumnResize();
initLiveReload(documentPath);
initSourceLines();
initCodeCopy();
initDiagrams();
initCharts();
initGraph();
initLocalGraph();
initSearch();
initDiagnostics(documentPath);
initDashboard();
initConfigEditor();
initOpenConfig();
