import { readFile } from "node:fs/promises";
import path from "node:path";

import GithubSlugger from "github-slugger";
import type { Definition, Heading, Image, Link, LinkReference, Root } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";

import type { AnchorIndex, MarkdownFile, MarkdownLink, MarkdownLinkKind } from "../types.js";
import { normalizeRelativePath } from "../discovery/globs.js";

type LinkLikeNode = Link | LinkReference | Image;

type MarkdownParseResult = {
  files: MarkdownFile[];
  links: MarkdownLink[];
  anchorIndex: AnchorIndex;
};

const markdownProcessor = remark().use(remarkParse).use(remarkGfm);

function decodePathSegments(value: string): string {
  return value
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function extractHeadingText(node: Heading): string {
  let text = "";

  visit(node, (child) => {
    if ("value" in child && typeof child.value === "string") {
      text += child.value;
    }
  });

  return text;
}

function buildAnchorIndex(tree: Root): string[] {
  const slugger = new GithubSlugger();
  const anchors: string[] = [];

  visit(tree, "heading", (node: Heading) => {
    const headingText = extractHeadingText(node);
    anchors.push(slugger.slug(headingText));
  });

  return anchors;
}

function getReferenceDefinitions(tree: Root): Map<string, string> {
  const definitions = new Map<string, string>();

  visit(tree, "definition", (node: Definition) => {
    definitions.set(node.identifier, node.url);
  });

  return definitions;
}

function resolveRawTarget(node: LinkLikeNode, definitions: Map<string, string>): string | undefined {
  if ("url" in node) {
    return node.url;
  }

  return definitions.get(node.identifier);
}

function extractPosition(node: LinkLikeNode): Pick<MarkdownLink, "line" | "column"> {
  const start = node.position?.start;

  return {
    line: start?.line,
    column: start?.column
  };
}

function classifyLinkTarget(rawTarget: string): {
  kind: MarkdownLinkKind;
  targetPath?: string;
  anchor?: string;
} {
  if (rawTarget.startsWith("#")) {
    return {
      kind: "same-file-anchor",
      anchor: decodePathSegments(rawTarget.slice(1))
    };
  }

  let parsed: URL | undefined;

  try {
    parsed = new URL(rawTarget);
  } catch {
    parsed = undefined;
  }

  if (parsed?.protocol === "http:" || parsed?.protocol === "https:") {
    return { kind: "external" };
  }

  if (parsed?.protocol === "mailto:") {
    return { kind: "mailto" };
  }

  if (parsed?.protocol !== undefined) {
    return { kind: "other" };
  }

  const [rawPathPart, rawAnchorPart] = rawTarget.split("#", 2);
  const normalizedPathPart = decodePathSegments(rawPathPart);

  return {
    kind: "local-file",
    targetPath: normalizedPathPart,
    anchor: rawAnchorPart === undefined ? undefined : decodePathSegments(rawAnchorPart)
  };
}

function resolveLocalTargetPath(sourcePath: string, targetPath: string): string {
  const sourceDirectory = path.posix.dirname(sourcePath);
  return normalizeRelativePath(path.posix.normalize(path.posix.join(sourceDirectory, targetPath)));
}

function shouldIncludeImageTarget(rawTarget: string): boolean {
  const pathPart = rawTarget.split("#", 1)[0] ?? "";

  try {
    const parsed = new URL(rawTarget);
    return parsed.protocol === "file:" && parsed.pathname.endsWith(".md");
  } catch {
    return pathPart.endsWith(".md");
  }
}

function extractLinksFromTree(
  tree: Root,
  sourcePath: string,
  definitions: Map<string, string>
): MarkdownLink[] {
  const links: MarkdownLink[] = [];

  visit(tree, (node) => {
    if (node.type !== "link" && node.type !== "linkReference" && node.type !== "image") {
      return;
    }

    const linkNode = node as LinkLikeNode;
    const rawTarget = resolveRawTarget(linkNode, definitions);

    if (rawTarget === undefined) {
      return;
    }

    if (linkNode.type === "image" && !shouldIncludeImageTarget(rawTarget)) {
      return;
    }

    const classified = classifyLinkTarget(rawTarget);
    const position = extractPosition(linkNode);

    if (classified.kind === "local-file" && classified.targetPath !== undefined) {
      links.push({
        sourcePath,
        rawTarget,
        kind: classified.kind,
        targetPath: resolveLocalTargetPath(sourcePath, classified.targetPath),
        anchor: classified.anchor,
        ...position
      });
      return;
    }

    links.push({
      sourcePath,
      rawTarget,
      kind: classified.kind,
      anchor: classified.anchor,
      ...position
    });
  });

  return links;
}

export async function parseMarkdownFiles(files: MarkdownFile[]): Promise<MarkdownParseResult> {
  const parsedFiles: MarkdownFile[] = [];
  const links: MarkdownLink[] = [];
  const anchorIndex: AnchorIndex = {};

  for (const file of files) {
    const text = file.text ?? (await readFile(file.absolutePath, "utf8"));
    const tree = markdownProcessor.parse(text) as Root;
    const definitions = getReferenceDefinitions(tree);
    const anchors = buildAnchorIndex(tree);

    parsedFiles.push({
      ...file,
      text
    });
    anchorIndex[file.path] = anchors;
    links.push(...extractLinksFromTree(tree, file.path, definitions));
  }

  links.sort((left, right) => {
    return (
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.rawTarget.localeCompare(right.rawTarget)
    );
  });

  return {
    files: parsedFiles,
    links,
    anchorIndex
  };
}
