# @wastech-mdlint/viewer

A local web viewer for a repository's Markdown. It serves exactly the corpus [wastech-mdlint](https://github.com/VladimirMakarevich/wastech-mdlint#readme) lints, as pages with the document tree, highlighted code, Mermaid diagrams, ECharts charts, an outline, backlinks, full-text search and the linter's findings, and reloads an open page when its file changes.

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

## What it shows

- **The linted corpus.** The config's `include`, `exclude` and `respectGitignore` decide which files are documents, the same way `wastech-mdlint lint` decides, including dot-directories such as `.claude/` when the config includes them. Without a config, every Markdown file outside the default excludes.
- **Links that agree with the linter.** A relative or root-relative link resolves the way REF-001 resolves it, and heading ids are the slugs REF-002 checks anchors against, so a link the linter accepts works on the page. A link to a folder opens that folder's `README.md`. A link whose target does not exist is underlined in red.
- **Linked source files.** A link from a document to a non-Markdown file opens it as highlighted source with line numbers; `#L42` and GitHub's `#L12-L20` ranges land on and mark those lines. Images a document embeds are served as they are.
- **Code and diagrams.** Fenced code is highlighted on the server with Shiki in light and dark themes. A `mermaid` block is drawn in the browser; if it cannot be drawn, its source stays on the page with the reason.
- **Charts.** An `echarts` block holds an [ECharts option](https://echarts.apache.org/en/option.html) written as JSON — strict JSON, so no functions, comments or unquoted keys — and is drawn in the browser in the page's theme. A block that is not a JSON object says why above its source, with or without script. Tooltips are drawn as text on the chart, so markup in a `formatter` shows as written rather than as HTML, while `<br/>` still breaks the line.
- **Front matter** as a card above the article, an **outline** of the document's `h2` and `h3` headings, and **backlinks**: the documents that link to this one, from the context graph.
- **Search.** The box in the header searches titles, headings, paths and text, Cyrillic included, and matches a word while it is still being typed. `Ctrl+K` (or `/`) focuses it, the arrow keys pick a result and `Enter` opens it at the heading nearest the match. Without script, the same box opens a results page.
- **Lint findings.** The config's rules run over the corpus in the background. A document with findings shows them in a panel above its text — severity, rule, message and the heading to jump to — and the tree shows a count beside every file that has any. Both refresh on their own after each save.
- **Live reload.** Saving a document reloads the pages showing it and keeps the scroll position. A new or deleted document, or a change to the config or a `.gitignore`, refreshes the tree on every open page.

The theme switch in the header cycles through Auto (follow the operating system), Light and Dark, and the choice is remembered for this address.

## Security

The viewer is read-only and bound to `127.0.0.1` unless `--host` says otherwise. Because any web page in the same browser can make requests to it:

- it answers only requests addressed to localhost, an IP address or the configured host, which defeats DNS rebinding, and refuses requests from other origins;
- it serves documents in the corpus and only the files those documents link to or embed, so a request cannot read an arbitrary file by naming it; paths that could climb out of the repository are refused before any lookup, and symlinks that lead outside it are not followed;
- raw HTML in Markdown is sanitized with GitHub's allowlist, every page carries a Content-Security-Policy that allows scripts from the viewer only, and images (SVG included) are served sandboxed;
- a chart option is data: it is parsed as JSON and never evaluated, every tooltip in it is drawn as text, the data view's labels (which ECharts would insert as HTML) are dropped, and a `link` or `sublink` survives only as an `http(s)` URL;
- nothing is fetched from the network: Mermaid, ECharts and the page assets come from the installed packages.

## Known limits

- Startup loads and parses the whole corpus, as `wastech-mdlint lint` does: about eight seconds for six hundred documents. After that an edit to a document is applied, re-linted and re-indexed in well under a second; adding or removing a document reloads the corpus.
- The search index is built on the first search (about a second for six hundred documents) and kept in memory.
- On Linux, Node watches a directory tree with one inotify watch per directory, so a very large `node_modules` inside the repository can exhaust the watch limit. Run with `--no-watch` there, or raise `fs.inotify.max_user_watches`.
