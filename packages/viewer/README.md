# @wastech-mdlint/viewer

A local web viewer for a repository's Markdown. It serves exactly the corpus [wastech-mdlint](https://github.com/VladimirMakarevich/wastech-mdlint#readme) lints, as pages with the document tree, highlighted code, Mermaid diagrams, ECharts charts, an outline, backlinks, a graph of the links between documents, full-text search, the linter's findings and a dashboard of the whole corpus, lets the linter's config be edited with a preview of what it would report, and reloads an open page when its file changes.

**Experimental.** The package is `private` in this repository and is not published yet.

## Run it

From this repository, after `npm run build`:

```bash
node packages/viewer/dist/index.js path/to/repository
```

It prints the address, by default `http://127.0.0.1:4180/`. The root opens the repository's `README.md`.

| Option | Meaning |
| --- | --- |
| `[path]` | Repository directory; the current directory when omitted. |
| `-p, --port <n>` | Port. Without it the viewer takes `4180`, or the next free port above it. `0` picks any free port. |
| `--host <host>` | Address to bind. The default `127.0.0.1` keeps the documents on this machine; any other address lets the network read them, and the viewer says so when it starts. |
| `-c, --config <file>` | The `wastech-mdlint.config.json` to use instead of the one found in the repository. |
| `--no-watch` | Do not watch files or reload pages. |
| `--allow-config-writes` | Let the config page save changes to the config file. Off by default, and refused together with a `--host` that is not a loopback address. |

## What it shows

- **The linted corpus.** The config's `include`, `exclude` and `respectGitignore` decide which files are documents, the same way `wastech-mdlint lint` decides, including dot-directories such as `.claude/` when the config includes them. Without a config, every Markdown file outside the default excludes.
- **Links that agree with the linter.** A relative or root-relative link resolves the way REF-001 resolves it, and heading ids are the slugs REF-002 checks anchors against, so a link the linter accepts works on the page. A link to a folder opens that folder's `README.md`. A link whose target does not exist is underlined in red.
- **Linked source files.** A link from a document to a non-Markdown file opens it as highlighted source with line numbers; `#L42` and GitHub's `#L12-L20` ranges land on and mark those lines. Images a document embeds are served as they are.
- **Code and diagrams.** Fenced code is highlighted on the server with Shiki in light and dark themes. A `mermaid` block is drawn in the browser; if it cannot be drawn, its source stays on the page with the reason.
- **Charts.** An `echarts` block holds an [ECharts option](https://echarts.apache.org/en/option.html) written as JSON — strict JSON, so no functions, comments or unquoted keys — and is drawn in the browser in the page's theme. A block that is not a JSON object says why above its source, with or without script. Tooltips are drawn as text on the chart, so markup in a `formatter` shows as written rather than as HTML, while `<br/>` still breaks the line.
- **Link graph.** `Graph` in the header opens every document as a node and every linked pair as a line, from the same context graph `wastech-mdlint graph` reports; hovering a document lights its links and names its neighbors without dimming the rest. Documents are laid out a few node widths apart, and a large graph opens zoomed out to fit; only the most linked-to documents are named until the wheel zooms in far enough, and then the other names grow in. The folder picker narrows it to one folder and colors that folder's subfolders apart; dragging pans, a click opens the document. Opened from a document, the graph centers on it, draws its own links as arrows in the accent color, and turns every document outside its direct neighbors gray. A save that changes a link redraws it. Without script, the page lists the documents in view, and the same data is at `/api/graph?folder=…&focus=…`.
- **Source lines.** Beside every block and list item, in the right margin, the line it starts on in the Markdown file, counted from the top with front matter included — the line an editor and a finding name. Selecting and copying the article leaves the numbers out, and they are hidden on a narrow screen and in print.
- **Front matter** as a card above the article, an **outline** of the document's `h2` and `h3` headings, and **backlinks**: the documents that link to this one, from the context graph.
- **Local graph.** Above the outline, a small graph of the document, the documents it links to and the ones linking to it, with the links among them (`/api/neighbors?path=…`). A click on a neighbor opens it, and a link below opens the full graph centered on the document. It is drawn only where the side column shows, so a narrow screen never loads it.
- **Search.** The box in the header searches titles, headings, paths and text, Cyrillic included, and matches a word while it is still being typed. `Ctrl+K` (or `/`) focuses it, the arrow keys pick a result and `Enter` opens it at the heading nearest the match. Without script, the same box opens a results page.
- **Lint findings.** The config's rules run over the corpus in the background. A document with findings shows them in a panel above its text — severity, rule, message and the heading to jump to — and the tree shows a count beside every file that has any. Both refresh on their own after each save.
- **Dashboard.** `Dashboard` in the header lists every document with its errors, warnings and the rules behind them, its size in KB, lines and tokens (the counts SIZE-001 checks), how many documents link to it and how many it links to, and whether it is an orphan (nothing links to it), a dead end (it links nowhere), on a link cycle (as GRP-001 sees them) or outside the main group of linked documents. The filters pick documents with errors and/or warnings, from chosen rules (a severity and a rule are judged on the same finding), within a size, line or token range (both bounds included, a KB being 1024 bytes), with chosen link flags, in a folder, or with a text in the path; a column header sorts by that column. It works as a plain form without script; with script every change applies as it is made, and findings and sizes follow each save. The address carries the filters, `/api/dashboard?…` answers the same query as JSON, and the download links give the selection as CSV or JSON. A switch above the tree shows only the files with findings.
- **Config.** `Config` in the header shows the config file and every rule in the registry with its description. With script, a form built from the config schema edits the files, the rules — adding one from the registry, removing one, its severity and options — custom rules, settings and compile options; a Text view edits the file as a whole. Each change is checked by the linter's own config loader, and the preview says what the change would report: the findings it adds and removes, per rule and one by one, or the loader's reason when the config would not load. The changed file can be copied or downloaded, or saved when the viewer was started with `--allow-config-writes`. Only the edited values change in the file: every comment and the layout of the rest stay as written. A preview that changes only rules takes a fraction of a second; one that changes `include`, `exclude` or `respectGitignore` reads the corpus again, as at startup.
- **Live reload.** Saving a document reloads the pages showing it and keeps the scroll position. A new or deleted document, or a change to the config or a `.gitignore`, refreshes the tree on every open page.

The theme switch in the header cycles through Auto (follow the operating system), Light and Dark, and the choice is remembered for this address. So are the widths of the two side columns, the document tree and the rail with the local graph, outline and backlinks: hovering a column's edge toward the article shows a handle to drag (or focus it and use the arrow keys), a double click on the handle restores that column's default width, and the article always keeps room between them.

## Security

The viewer is bound to `127.0.0.1` unless `--host` says otherwise, and writes nothing to the repository unless it was started with `--allow-config-writes`. Because any web page in the same browser can make requests to it:

- it answers only requests addressed to localhost, an IP address or the configured host, which defeats DNS rebinding, and refuses requests from other origins;
- it serves documents in the corpus and only the files those documents link to or embed, so a request cannot read an arbitrary file by naming it; paths that could climb out of the repository are refused before any lookup, and symlinks that lead outside it are not followed;
- raw HTML in Markdown is sanitized with GitHub's allowlist, every page carries a Content-Security-Policy that allows scripts from the viewer only, and images (SVG included) are served sandboxed;
- a chart option is data: it is parsed as JSON and never evaluated, every tooltip in it is drawn as text, the data view's labels (which ECharts would insert as HTML) are dropped, and a `link` or `sublink` survives only as an `http(s)` URL;
- the config page's preview and save are the only requests with a body. Each must come from the viewer's own page — its origin, a JSON body and a random token only that page carries — and a save writes only the config file the corpus was loaded from, inside the repository, over the version the page saw, after the linter's loader has accepted the new text; it is written atomically and the previous text is put back if the file is not what was written;
- nothing is fetched from the network: Mermaid, ECharts and the page assets come from the installed packages.

## Known limits

- Startup loads and parses the whole corpus, as `wastech-mdlint lint` does: about eight seconds for six hundred documents. After that an edit to a document is applied, re-linted and re-indexed in well under a second; adding or removing a document reloads the corpus.
- The search index is built on the first search (about a second for six hundred documents) and kept in memory.
- The graph is laid out in the browser, every node against every other. Six hundred documents and three thousand links take about a tenth of a second to draw and then settle smoothly; on a corpus many times larger, narrow the graph to a folder.
- On Linux, Node watches a directory tree with one inotify watch per directory, so a very large `node_modules` inside the repository can exhaust the watch limit. Run with `--no-watch` there, or raise `fs.inotify.max_user_watches`.
