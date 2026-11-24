# Viewer Rules

`@wastech-mdlint/viewer` is the one host with a network listener, an HTML renderer and a write outside the repository, so it carries rules of its own. They apply to every change under `packages/viewer/` and to every core change the viewer reads. Everything that holds for all hosts — core ownership, read-only git through core's runner, command execution — is in [`architecture.md`](architecture.md) and [`security.md`](security.md) and holds here too.

`AGENTS.md` links this file and `CLAUDE.md` does not import it, because most sessions never touch the viewer and every imported file spends the shared context budget of every session.

## What Comes From Core

The viewer serves HTTP, renders HTML from the tree core parsed (`parseDocumentWithTree`), highlights code, reloads live, and keeps review marks. Every answer it shows comes from core, so a page and the CLI or MCP answer about the same documents never disagree:

- **Corpus and findings.** The corpus from `loadContext`, findings from `lintContext` over that same corpus, link targets from `resolveTargetCandidates`, which linked files it serves and which changed paths need a reload from `createScopeTester`, heading ids from core's slugs.
- **Graph and dashboard.** The link graph is that corpus's `ContextGraph` and a document's neighbors come from core's `query`; the viewer only narrows the graph to a folder and merges a pair's parallel edges into one line for drawing. The dashboard takes sizes from `measureDocument`, link flags from that graph (`cycles`, `getComponents`) and findings from the same lint run, and only filters, sorts and lays them out.
- **Config page.** It reads, checks and changes the config only through `parseConfiguration`, the generated schema and `editConfigText`, so what it previews or saves is a config `loadConfiguration` accepts, comments intact.
- **Branch review.** The change set, its order and the context it changes come from `reviewBranch` and `branchContext` — the same answer `lint --since`, `impact --since` and the MCP `since` give — with order from `rankByInfluence`, deltas from `computeContextDelta` and `compareFindings` (shared with the config preview), and links into edited code lines from `linksIntoChangedLines`. A document page marks its blocks and outline from `headChanges` and `changedSections`, renders the base side through the same pipeline, and takes sections from `documentSections`, diff lines, moves and the unchanged runs between hunks from `diffText` and `contextGaps`.
- **What the viewer owns:** review marks and their store. A mark's status is computed over core's `normalizeText`, and the diff since a review is core's `diffText`.

## Safety

Any open page can make the browser send this server requests. Its boundary:

- Bound to `127.0.0.1` by default; another address only through an explicit `--host`, which it announces.
- Read-only unless asked: `GET` and `HEAD` only, but for the config page's `POST` preview (writes nothing), save and open, and a review mark. A save needs `--allow-config-writes`; save, open and a review mark are refused with a non-loopback `--host`, as anyone reaching the port could then rewrite the config, start programs here or record a review as this user.
- A request with a body needs this server's `Origin`, same-origin fetch metadata if any, an `application/json` type (no HTML form can send it; a cross-origin `fetch` needs a preflight never approved) and the per-process token only the config page, the Changes page and a changed document's page carry; bodies stop at 256 KiB.
- A save writes only the config the corpus was loaded from, inside the repository, over the version the page edited, with text `parseConfiguration` accepts — atomically and read back; if another program wrote the file meanwhile, its newer version stays and the save reports a conflict.
- Review marks are the one write outside the repository: per clone, keyed by a hash of the git common directory's realpath, so every worktree of a clone shares them; an index of paths and content hashes plus the reviewed texts, owner-only, in the user's state directory or `--state-dir`. A mark names the text the page showed and is refused with 409 otherwise; it is written atomically under a lock every viewer of the clone shares, a failed write is reported with the previous state whole, and `GET` creates nothing there.
- Open runs the system's file manager or default app on that config alone, from an argv list; a path with a `"` is refused.
- Every request's `Host` must be localhost, an IP literal or the configured host (DNS rebinding); one carrying another origin, or a non-navigation from another site, is refused.
- It serves corpus documents and only the non-Markdown files they link to or embed that no `exclude` pattern or `.gitignore` covers — every `.gitignore`, whatever `respectGitignore` says. A request path is decoded per segment and refused if it could leave the repository; every file read must really resolve inside it. Both versions of a changed code file a document links into by line are read to compare them and never served for that reason.
- Git runs only through core's runner: the Changes pages, a document page (one `rev-parse` per request, the review cached), the dashboard and graph with the branch shown, history and blame. `HEAD` and refs are followed by a watcher on only the top of the git directories and their `refs/`; the corpus watcher never looks inside `.git`. Blame shows an author's name only on a loopback binding, as a person's name is kept to this machine.
- Author HTML is sanitized before the viewer adds its own markup, `name` kept on `<a>` only so no author element shadows a member of `document`; pages carry a CSP allowing scripts from the viewer's origin only; SVG and other files served as-is are sandboxed.
- An `echarts` block is author data, parsed as JSON and never evaluated. ECharts would insert a tooltip's formatter and the data view's `title`/`lang` as `innerHTML` and open `link`/`sublink` with `window.open`, so every tooltip becomes `richText`, those labels are dropped and a link survives only as an http(s) URL.
- The graph's `folder` and `focus` and the prompts' `path` are only compared with the corpus's own paths, never joined onto a filesystem path; anything else is a 404.
- No CDN or network fetch: Mermaid, ECharts and every asset come from the installed packages.
