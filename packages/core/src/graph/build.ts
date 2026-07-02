import type { DependencyGraph, MarkdownFile, MarkdownLink } from "../types.js";

function isMarkdownLinkEdge(link: MarkdownLink): boolean {
  return (
    link.kind === "local-file" &&
    link.targetPath !== undefined &&
    link.targetPath.toLowerCase().endsWith(".md")
  );
}

export function buildDependencyGraph(params: {
  files: MarkdownFile[];
  links: MarkdownLink[];
}): DependencyGraph {
  const nodes = params.files
    .map((file) => ({
      path: file.path,
      bytes: file.bytes
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const knownFiles = new Set(nodes.map((node) => node.path));
  const edgeKeys = new Set<string>();

  for (const link of params.links) {
    if (!isMarkdownLinkEdge(link)) {
      continue;
    }

    const to = link.targetPath;

    if (to === undefined) {
      continue;
    }

    if (!knownFiles.has(to)) {
      continue;
    }

    if (link.sourcePath === to) {
      continue;
    }

    edgeKeys.add(`${link.sourcePath}\u0000${to}\u0000markdown-link`);
  }

  const edges = [...edgeKeys]
    .map((edgeKey) => {
      const [from, to] = edgeKey.split("\u0000");

      return {
        from,
        to,
        kind: "markdown-link" as const
      };
    })
    .sort((left, right) => {
      return (
        left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to) ||
        left.kind.localeCompare(right.kind)
      );
    });

  return {
    nodes,
    edges
  };
}
