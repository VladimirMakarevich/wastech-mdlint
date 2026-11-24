import type { Element, ElementContent, Root as HastRoot } from "hast";
import { h } from "hastscript";
import { visit } from "unist-util-visit";

import type { HeadChanges, HeadRemoval } from "@wastech-mdlint/core";

// Marks on a rendered document for what the branch changed in it. The page's blocks are the ones it
// numbers with their source line — every top-level block and every list item — and the diff is core's,
// restated in head line numbers by `headChanges`, so a block is matched to a change by line ranges
// alone and the rendered text never has to be compared with anything.

export type ChangeKind = "added" | "changed";

/** How one block changed, and which of the diff's hunks show it. */
export type BlockChange = { kind: ChangeKind; hunks: number[] };

/** A range of 1-based source lines, first and last inclusive. */
export type LineRange = { start: number; end: number };

/** One side of the comparison, rendered: its tree and which of its lines hold no text. */
export type MarkedSide = {
  tree: HastRoot;
  // Front matter is drawn by the page as a card outside the article, so it has no node in the tree;
  // its lines still count, as a block of their own.
  frontmatter?: LineRange & { raw: string };
  blank: (line: number) => boolean;
};

type Container = HastRoot | Element;

type Block = LineRange & {
  node: Element;
  // The parent whose children hold `node`, where a removed block can be inserted beside it.
  container: Container;
  // A list is never marked itself, only its items, so a changed item is not drowned in a bar along
  // the whole list.
  list: boolean;
  // A list's items; for anything else, the lists inside it — a list item's nested lists, or a list
  // in a block quote — whose items are blocks of their own.
  children: Block[];
};

/**
 * Mark the head's changed blocks and put back the base blocks the branch removed, folded where they
 * stood. Returns how the front matter changed, which the page marks on its card.
 *
 * A block is `added` when every line of text in it is new, and `changed` when it holds a new or
 * edited line, or lost lines that were part of it, that no list item within it accounts for: the
 * innermost block wins, so an edited item marks the item and not its list. Blank lines are left out
 * of "every line", since the line diff matches a blank line with any other blank line and so may keep
 * one that sat inside a block it otherwise removed or added.
 */
export function markChanges(
  head: MarkedSide,
  base: MarkedSide,
  changes: HeadChanges,
): BlockChange | undefined {
  const headBlocks = blocksIn(head.tree, false);
  // The card as a block of its own, so its lines are matched like any other block's; its node is a
  // stand-in, never placed in the tree.
  const card =
    head.frontmatter === undefined
      ? undefined
      : frontmatterBlock(head.frontmatter, h("section"), head.tree);
  const markable = card === undefined ? headBlocks : [card, ...headBlocks];

  const { removed, lost } = compareWithBase(base, changes);
  const lostBy = new Map<Element, number[]>();
  for (const { removal, at } of lost) {
    const node = blockLosing(markable, removal.after, at);
    if (node !== undefined) {
      lostBy.set(node, [...(lostBy.get(node) ?? []), removal.hunk]);
    }
  }

  const marks = new Map<Element, BlockChange>();
  collectMarks(markable, { changes, blank: head.blank, lostBy }, marks);
  for (const [node, change] of marks) {
    if (node !== card?.node) {
      node.properties.dataChange = change.kind;
      node.properties.dataChangeHunks = change.hunks.join(" ");
    }
  }
  insertRemoved(head.tree, headBlocks, removed);
  return card === undefined ? undefined : marks.get(card.node);
}

function rangeOf(node: Element): LineRange | undefined {
  if (node.position !== undefined) {
    return { start: node.position.start.line, end: node.position.end.line };
  }
  // A block that scrolls sideways is wrapped, and the wrapper carries its lines instead.
  const { dataLine, dataLineEnd } = node.properties;
  return typeof dataLine === "number" && typeof dataLineEnd === "number"
    ? { start: dataLine, end: dataLineEnd }
    : undefined;
}

const isList = (node: Element) =>
  node.tagName === "ul" || node.tagName === "ol";

function blocksIn(container: Container, itemsOnly: boolean): Block[] {
  const blocks: Block[] = [];
  for (const child of container.children) {
    if (child.type !== "element" || (itemsOnly && child.tagName !== "li")) {
      continue;
    }
    const range = rangeOf(child);
    if (range === undefined) {
      continue;
    }
    const list = isList(child);
    blocks.push({
      ...range,
      node: child,
      container,
      list,
      children: list ? blocksIn(child, true) : listsWithin(child),
    });
  }
  return blocks;
}

function listsWithin(node: Element): Block[] {
  const lists: Block[] = [];
  const walk = (parent: Element) => {
    for (const child of parent.children) {
      if (child.type !== "element") {
        continue;
      }
      const range = isList(child) ? rangeOf(child) : undefined;
      if (range !== undefined) {
        lists.push({
          ...range,
          node: child,
          container: parent,
          list: true,
          children: blocksIn(child, true),
        });
      } else {
        walk(child);
      }
    }
  };
  walk(node);
  return lists;
}

function frontmatterBlock(
  range: LineRange,
  node: Element,
  container: Container,
): Block {
  return {
    start: range.start,
    end: range.end,
    node,
    container,
    list: false,
    children: [],
  };
}

function linesOf(range: LineRange): number[] {
  const lines: number[] = [];
  for (let line = range.start; line <= range.end; line += 1) {
    lines.push(line);
  }
  return lines;
}

const within = (range: LineRange, line: number) =>
  line >= range.start && line <= range.end;

// Every block that can carry a mark, at any depth: everything but the lists themselves.
function markableBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((block) => [
    ...(block.list ? [] : [block]),
    ...markableBlocks(block.children),
  ]);
}

function innermost(blocks: Block[]): Block | undefined {
  let found: Block | undefined;
  for (const block of blocks) {
    if (
      found === undefined ||
      block.end - block.start <= found.end - found.start
    ) {
      found = block;
    }
  }
  return found;
}

// What every block is judged against: the head changes, which head lines are blank, and the hunks
// whose removed lines each block lost.
type MarkInputs = {
  changes: HeadChanges;
  blank: (line: number) => boolean;
  lostBy: ReadonlyMap<Element, number[]>;
};

function collectMarks(
  blocks: Block[],
  inputs: MarkInputs,
  marks: Map<Element, BlockChange>,
): void {
  const { changes, blank, lostBy } = inputs;
  for (const block of blocks) {
    if (block.list) {
      collectMarks(block.children, inputs, marks);
      continue;
    }
    const change = classify(block, changes, blank, lostBy.get(block.node));
    // A wholly new block is marked once, not again on every new item inside it.
    if (change?.kind !== "added") {
      collectMarks(block.children, inputs, marks);
    }
    if (change !== undefined) {
      marks.set(block.node, change);
    }
  }
}

function classify(
  block: Block,
  changes: HeadChanges,
  blank: (line: number) => boolean,
  lostHunks: number[] | undefined,
): BlockChange | undefined {
  const textLines = linesOf(block).filter((line) => !blank(line));
  if (
    lostHunks === undefined &&
    textLines.length > 0 &&
    textLines.every((line) => changes.lines.get(line)?.kind === "added")
  ) {
    return {
      kind: "added",
      hunks: hunksOf(textLines.map((line) => changes.lines.get(line)!.hunk)),
    };
  }
  const ownLines = linesOf(block).filter(
    (line) =>
      changes.lines.has(line) &&
      !block.children.some((child) => within(child, line)),
  );
  if (ownLines.length === 0 && lostHunks === undefined) {
    return undefined;
  }
  return {
    kind: "changed",
    hunks: hunksOf([
      ...ownLines.map((line) => changes.lines.get(line)!.hunk),
      ...(lostHunks ?? []),
    ]),
  };
}

function hunksOf(indexes: number[]): number[] {
  return [...new Set(indexes)].sort((a, b) => a - b);
}

type Removed = { block: Block; after: number };

// Where in a block that survived the lines it lost had been: before every line it kept, after every
// one, or between them. That decides which head block they are missing from, since the place they
// stood is a line number between two head lines, and either neighbor could be the block.
type LostAt = "start" | "middle" | "end";

/**
 * Read the base against the diff. `removed`: the base's blocks whose every line of text left without
 * a counterpart, outermost first — a list whose items all went is one removed list, while a list that
 * kept some items has its removed items listed one by one; a block with an edited line is not removed,
 * since the head shows it, changed. `lost`: removed lines that were part of a block that survived,
 * such as a table's last row or a line of a wrapped paragraph.
 */
function compareWithBase(
  base: MarkedSide,
  changes: HeadChanges,
): { removed: Removed[]; lost: { removal: HeadRemoval; at: LostAt }[] } {
  const gone = new Map<number, HeadRemoval>();
  for (const removal of changes.removals) {
    for (const line of removal.baseLines) {
      gone.set(line, removal);
    }
  }
  const blocks = blocksIn(base.tree, false);
  if (base.frontmatter !== undefined) {
    blocks.unshift(
      frontmatterBlock(
        base.frontmatter,
        h(
          "section.frontmatter",
          { ariaLabel: "Front matter" },
          h("pre", base.frontmatter.raw),
        ),
        base.tree,
      ),
    );
  }

  const removed: Removed[] = [];
  const kept: Block[] = [];
  const walk = (level: Block[]) => {
    for (const block of level) {
      const textLines = linesOf(block).filter((line) => !base.blank(line));
      if (textLines.length > 0 && textLines.every((line) => gone.has(line))) {
        removed.push({ block, after: gone.get(textLines[0]!)!.after });
        continue;
      }
      if (!block.list) {
        kept.push(block);
      }
      walk(block.children);
    }
  };
  walk(blocks);

  const lost: { removal: HeadRemoval; at: LostAt }[] = [];
  for (const [line, removal] of gone) {
    if (removed.some(({ block }) => within(block, line))) {
      continue;
    }
    const holder = innermost(kept.filter((block) => within(block, line)));
    // A blank line counts only from inside a block with no items in it, such as a code block: between
    // two list items it is the list's spacing, not a line of either item.
    if (
      holder === undefined ||
      (base.blank(line) &&
        (holder.children.length > 0 ||
          line === holder.start ||
          line === holder.end))
    ) {
      continue;
    }
    const remaining = linesOf(holder).filter(
      (other) => !gone.has(other) && !base.blank(other),
    );
    lost.push({
      removal,
      at: lostAt(remaining, line),
    });
  }
  return { removed, lost };
}

// Where in its block a removed line was: before every line the block still has, after every one,
// or between them.
function lostAt(remaining: readonly number[], line: number): LostAt {
  if (remaining.every((other) => other > line)) {
    return "start";
  }
  if (remaining.every((other) => other < line)) {
    return "end";
  }
  return "middle";
}

// Which blocks to look in, in order, for the one that lost lines: lines lost at a block's start
// look first at the block that begins right after them, lines lost at its end at the block that
// ends right before them, and lines lost in its middle at the block they were inside.
const LOSING_ORDER: Record<
  LostAt,
  readonly ("before" | "inside" | "behind")[]
> = {
  start: ["before", "inside", "behind"],
  end: ["behind", "inside", "before"],
  middle: ["inside", "behind", "before"],
};

/** The head block that lines removed after head line `after` were part of. */
function blockLosing(
  blocks: Block[],
  after: number,
  at: LostAt,
): Element | undefined {
  const candidates = markableBlocks(blocks);
  const tests = {
    inside: (block: Block) => after >= block.start && after < block.end,
    before: (block: Block) => block.start === after + 1,
    behind: (block: Block) => block.end === after,
  };
  for (const test of LOSING_ORDER[at].map((name) => tests[name])) {
    const found = innermost(candidates.filter(test));
    if (found !== undefined) {
      return found.node;
    }
  }
  return undefined;
}

/**
 * Put each removed block back where it stood, folded: between the head's blocks, or between the items
 * of a list when it stood inside one. Neighbors that stood at the same place share one fold.
 */
function insertRemoved(
  tree: HastRoot,
  headBlocks: Block[],
  removed: Removed[],
): void {
  const groups = new Map<
    Container,
    Map<Element | undefined, { container: Container; blocks: Block[] }>
  >();
  for (const { block, after } of removed) {
    const { container, before } = insertionPoint(headBlocks, tree, after);
    let byPlace = groups.get(container);
    if (byPlace === undefined) {
      byPlace = new Map();
      groups.set(container, byPlace);
    }
    const group = byPlace.get(before) ?? { container, blocks: [] };
    group.blocks.push(block);
    byPlace.set(before, group);
  }
  for (const byPlace of groups.values()) {
    for (const [before, group] of byPlace) {
      const children = group.container.children as ElementContent[];
      const index =
        before === undefined ? children.length : children.indexOf(before);
      children.splice(index, 0, fold(group.container, group.blocks));
    }
  }
}

// Inside a list only when the place is strictly inside it, between two of its items. Removed lines
// right after a list's last item could as well have followed the list, and a top-level block put back
// inside a list would read as one of its items.
function insertionPoint(
  blocks: Block[],
  container: Container,
  after: number,
): { container: Container; before: Element | undefined } {
  const inside = (block: Block) => after >= block.start && after < block.end;
  const holder = blocks.find(inside);
  if (holder !== undefined) {
    const list = holder.list ? holder : holder.children.find(inside);
    if (list !== undefined) {
      return insertionPoint(list.children, list.node, after);
    }
  }
  return {
    container,
    before: blocks.find((block) => block.start > after)?.node,
  };
}

function fold(container: Container, blocks: Block[]): Element {
  const items = blocks.every((block) => block.node.tagName === "li");
  const noun = items ? "list item" : "block";
  const details = h("details.change-removed", [
    h(
      "summary",
      `${blocks.length} ${noun}${blocks.length === 1 ? "" : "s"} removed`,
    ),
    h(
      "div.change-removed-body",
      blocks.map((block) => detach(block)),
    ),
  ]);
  // A list holds only items; the fold becomes one, kept out of the list's numbering by the stylesheet.
  return container.type === "element" && isList(container)
    ? h("li.change-removed-item", details)
    : details;
}

/**
 * A removed block, ready to show inside the head's page. An item keeps its own list around it — an
 * ordered one starting at the number the item had — so it renders as the item it was. Everything
 * that ties it to its place in the base goes: base line numbers, which are not lines of this file,
 * and ids and anchor names, which could duplicate the head's and send a link to the removed copy.
 */
function detach(block: Block): Element {
  let node = block.node;
  const [only] = node.children;
  if (
    node.tagName === "div" &&
    node.properties.dataLine !== undefined &&
    node.children.length === 1 &&
    only?.type === "element"
  ) {
    // The wrapper only exists to hold a line number beside a block that scrolls sideways.
    node = only;
  }
  visit(node, "element", (element: Element) => {
    delete element.properties.dataLine;
    delete element.properties.dataLineEnd;
    delete element.properties.id;
    delete element.properties.name;
  });
  if (node.tagName !== "li" || block.container.type !== "element") {
    return node;
  }
  const list = block.container;
  const start =
    list.tagName === "ol"
      ? (Number(list.properties.start ?? 1) || 1) +
        list.children
          .filter(
            (child): child is Element =>
              child.type === "element" && child.tagName === "li",
          )
          .indexOf(block.node)
      : undefined;
  return h(
    list.tagName,
    {
      className: list.properties.className,
      start: start === 1 ? undefined : start,
    },
    [node],
  );
}
