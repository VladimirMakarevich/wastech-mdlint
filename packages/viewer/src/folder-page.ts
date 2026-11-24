import type { ElementContent } from "hast";
import { h } from "hastscript";

import { compareStrings, type ParsedDocument } from "@wastech-mdlint/core";

import { documentHref, documentTitle, folderHref } from "./render-document.js";

// The page a link to a folder opens when the folder has no README or index of its own: what GitHub
// shows for such a link, a listing of the folder. Built only from the corpus's own paths, so it lists
// documents and the folders that lead to them, never a file the viewer would not serve.

/**
 * The listing of `folder`: its subfolders that hold documents, then the documents directly in it.
 * The caller checks that `folder` is one of the corpus's folders; an unknown name is a 404, not an
 * empty listing.
 */
export function renderFolderArticle(
  folder: string,
  documents: ReadonlyMap<string, ParsedDocument>,
): ElementContent[] {
  const prefix = folder === "" ? "" : `${folder}/`;
  const subfolders = new Set<string>();
  const files: ParsedDocument[] = [];
  for (const [relPath, document] of documents) {
    if (!relPath.startsWith(prefix)) {
      continue;
    }
    const rest = relPath.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.push(document);
    } else {
      subfolders.add(rest.slice(0, slash));
    }
  }
  files.sort((left, right) => compareStrings(left.path, right.path));
  const scope = new URLSearchParams(folder === "" ? {} : { folder }).toString();
  const suffix = scope === "" ? "" : `?${scope}`;
  return [
    h("nav.folder-crumbs", { "aria-label": "Folders" }, crumbs(folder)),
    h("h1", folder === "" ? "All documents" : `${folder}/`),
    h("p.folder-views", [
      "See these documents in ",
      h("a", { href: `/graph${suffix}` }, "the graph"),
      " or ",
      h("a", { href: `/dashboard${suffix}` }, "the dashboard"),
      ".",
    ]),
    h("ul.folder-listing", [
      ...[...subfolders]
        .sort(compareStrings)
        .map((name) =>
          h("li.folder-entry-folder", [
            h("a", { href: folderHref(`${prefix}${name}`) }, `${name}/`),
          ]),
        ),
      ...files.map((document) => {
        const name = document.path.slice(prefix.length);
        const title = documentTitle(document);
        // A document without a top-level heading is titled by its file name already.
        return h("li.folder-entry-document", [
          h("a", { href: documentHref(document.path) }, title),
          ...(title === name ? [] : [" ", h("span.folder-entry-name", name)]),
        ]);
      }),
    ]),
  ];
}

// Each folder above this one, so a reader can climb back up without the tree.
function crumbs(folder: string): ElementContent[] {
  const items: ElementContent[] = [h("a", { href: folderHref("") }, "/")];
  if (folder === "") {
    return items;
  }
  const segments = folder.split("/");
  segments.forEach((segment, index) => {
    const path = segments.slice(0, index + 1).join("/");
    items.push(
      index === segments.length - 1
        ? h("span", { "aria-current": "page" }, `${segment}/`)
        : h("a", { href: folderHref(path) }, `${segment}/`),
    );
  });
  return items;
}
