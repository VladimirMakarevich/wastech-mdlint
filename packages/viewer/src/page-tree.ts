import type { Element } from "hast";
import { h } from "hastscript";

import { compareStrings } from "@wastech-mdlint/core";

import { documentHref } from "./render-document.js";
import {
  changeLetter,
  findingsBadge,
  reviewDot,
  type TreeMarks,
} from "./tree-marks.js";

// The document tree every page carries, with the marks beside its files.

type DirectoryNode = {
  name: string;
  path: string;
  directories: Map<string, DirectoryNode>;
  files: string[];
};

// What the tree is drawn with: the page's own document, which it opens the folders toward, and each
// file's marks. The flags name every file that has findings, changed, or is left to review, and every
// folder on the way to one: the tree's switches show only those rows, and open those folders.
type TreeContext = {
  currentPath: string | undefined;
  marks: TreeMarks | undefined;
  findings: ReadonlySet<string>;
  changed: ReadonlySet<string>;
  unreviewed: ReadonlySet<string>;
};

export function renderTree(
  paths: readonly string[],
  currentPath: string | undefined,
  marks: TreeMarks | undefined,
): Element {
  const root: DirectoryNode = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
  };
  for (const relPath of paths) {
    let directory = root;
    for (const segment of relPath.split("/").slice(0, -1)) {
      directory = childDirectory(directory, segment);
    }
    directory.files.push(relPath);
  }
  const changes = [...(marks?.changes?.files ?? [])];
  return renderDirectory(root, {
    currentPath,
    marks,
    findings: withFolders(Object.keys(marks?.findings ?? {})),
    changed: withFolders(changes.map(([relPath]) => relPath)),
    unreviewed: withFolders(
      changes.flatMap(([relPath, file]) =>
        file.review === "unreviewed" || file.review === "changed"
          ? [relPath]
          : [],
      ),
    ),
  });
}

function childDirectory(directory: DirectoryNode, segment: string) {
  let child = directory.directories.get(segment);
  if (child === undefined) {
    child = {
      name: segment,
      path: directory.path === "" ? segment : `${directory.path}/${segment}`,
      directories: new Map(),
      files: [],
    };
    directory.directories.set(segment, child);
  }
  return child;
}

// The paths and every folder that holds one of them.
function withFolders(paths: readonly string[]): Set<string> {
  const all = new Set<string>();
  for (const relPath of paths) {
    all.add(relPath);
    const segments = relPath.split("/");
    for (let end = 1; end < segments.length; end += 1) {
      all.add(segments.slice(0, end).join("/"));
    }
  }
  return all;
}

// The same attributes the page script sets when it redraws the marks.
function flagsOf(relPath: string, tree: TreeContext) {
  return {
    dataFindings: tree.findings.has(relPath) ? "" : undefined,
    dataChanged: tree.changed.has(relPath) ? "" : undefined,
    dataUnreviewed: tree.unreviewed.has(relPath) ? "" : undefined,
  };
}

// Folders before files, each in code-point order, the way an editor's file tree reads. Only the
// folders on the way to the current document start open: a few hundred documents fully expanded
// bury the one being read.
function renderDirectory(directory: DirectoryNode, tree: TreeContext): Element {
  const directories = [...directory.directories.values()].sort((a, b) =>
    compareStrings(a.name, b.name),
  );
  const files = [...directory.files].sort(compareStrings);
  return h("ul.tree", [
    ...directories.map((child) =>
      h("li", flagsOf(child.path, tree), [
        h(
          "details",
          {
            open: tree.currentPath?.startsWith(`${child.path}/`) === true,
            // The name the tree-state script keeps an open folder under from page to page.
            dataFolder: child.path,
          },
          [
            // Names longer than the tree is wide end in an ellipsis; the full path is the tooltip.
            h("summary", { title: child.path }, [
              h("span.tree-name", child.name),
            ]),
            renderDirectory(child, tree),
          ],
        ),
      ]),
    ),
    ...files.map((file) =>
      h("li", flagsOf(file, tree), [fileLink(file, tree)]),
    ),
  ]);
}

// A file's row: its name, then the branch's letter and the review dot, then its findings, in the
// order the page script puts them in when it redraws them.
function fileLink(file: string, tree: TreeContext): Element {
  const changed = tree.marks?.changes?.files.get(file);
  const findings = tree.marks?.findings;
  // Own keys only: the counts are a plain object keyed by path.
  const counts =
    findings !== undefined && Object.hasOwn(findings, file)
      ? findings[file]
      : undefined;
  return h(
    "a",
    {
      href: documentHref(file),
      title: file,
      ariaCurrent: file === tree.currentPath ? "page" : undefined,
    },
    [
      h("span.tree-name", file.split("/").pop() ?? file),
      changed === undefined ? undefined : changeLetter(changed),
      changed === undefined ? undefined : reviewDot(changed.review),
      counts === undefined ? undefined : findingsBadge(counts),
    ],
  );
}
