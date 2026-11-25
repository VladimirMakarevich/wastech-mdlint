import {
  createScanner,
  findNodeAtLocation,
  parseTree,
  printParseErrorCode,
  SyntaxKind,
  type Node,
  type ParseError,
} from "jsonc-parser";

import { detectNewline } from "../markdown/newline.js";
import { ConfigError } from "./config-error.js";
import { formatConfigIssue } from "./config-issues.js";

// Targeted edits to the text of a JSONC config, for a host that lets a user change the config one
// value at a time. The config carries its rationale as comments - why a glob is excluded, why a
// budget is what it is - and a parse-and-rebuild through `JSON.stringify`, which is how `init`
// merges, would silently delete every one of them.
//
// So an edit touches only the bytes of the value, property or element it names, and the separator
// beside it. Comments on other lines, and a comment trailing a neighbor on its own line, stay where
// they are; a comment on a removed member's own lines goes with it, because it described what is no
// longer there. jsonc-parser's `modify` was the obvious tool and was rejected for exactly this: it
// lets its formatter re-lay-out the line an insertion starts on, which spreads the previous rule
// entry over several lines, and removing a list's last element deletes the comment trailing the
// element before it. jsonc-parser still parses and locates; the text changes are made here.

export type ConfigEditPath = (string | number)[];

export type ConfigEdit =
  // Create or replace the value at `path`, creating the objects above it when they are missing.
  | { op: "set"; path: ConfigEditPath; value: unknown }
  // Remove the property or array element at `path`; nothing there is not an error.
  | { op: "remove"; path: ConfigEditPath }
  // Insert into the array the path ends in, before the element at that index; the array's length
  // appends.
  | { op: "insert"; path: ConfigEditPath; value: unknown };

type TextEdit = { offset: number; length: number; content: string };

type Style = { unit: string; eol: string };

// Thrown by the helpers below and reported against the edit that caused it.
class EditProblem extends Error {}

/**
 * Apply `edits` to config text in order, each against the text the previous one produced, so a path
 * names what is there after the edits before it (removing `rules[2]` moves `rules[3]` to index 2).
 *
 * New text follows the layout around it: a member added to a list or object written one member per
 * line gets a line of its own at the indentation of the others, spread over lines or kept to one
 * like its neighbor; one added to a list or object written on one line joins that line; and a
 * replaced value stays on one line if the value it replaces did. Indentation is tabs or the width of the file's first indented line, and the newline
 * is the file's own, detected from its bytes rather than the platform, so an edit to a CRLF config on
 * Linux does not leave it with mixed endings. Deterministic: the same text and edits always give the
 * same bytes. The result is not validated here; `parseConfiguration` decides whether it is a config.
 */
export function editConfigText(
  text: string,
  edits: readonly ConfigEdit[],
): string {
  const errors: ParseError[] = [];
  parseTree(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    // A broken document has no reliable tree to edit, and writing a best guess back could turn a typo
    // into a config that parses and means something else.
    throw new ConfigError(
      "CONFIG_INVALID",
      `Cannot edit config text that is not valid JSONC: ${errors
        .map(
          (error) =>
            `${printParseErrorCode(error.error)} at offset ${error.offset}`,
        )
        .join("; ")}`,
    );
  }

  const style = styleOf(text);
  let result = text;
  edits.forEach((edit, index) => {
    const problem = checkEdit(edit);
    if (problem !== undefined) {
      throw editError(index, edit.path, problem);
    }
    try {
      result = applyEdit(result, edit, style);
    } catch (error) {
      if (error instanceof EditProblem) {
        throw editError(index, edit.path, error.message);
      }
      throw error;
    }
  });
  return result;
}

function checkEdit(edit: ConfigEdit): string | undefined {
  if (edit.path.length === 0) {
    // The root is the whole file; replacing it is writing new text, not an edit to this one.
    return "an edit needs a path below the root";
  }
  if (
    edit.path.some(
      (segment) =>
        typeof segment === "number" &&
        (!Number.isInteger(segment) || segment < 0),
    )
  ) {
    return "an array index must be a whole number of zero or more";
  }
  if (edit.op === "insert" && typeof edit.path.at(-1) !== "number") {
    return "an insert needs a path that ends in an array index";
  }
  if (edit.op !== "remove" && edit.value === undefined) {
    // `undefined` has no JSON form, so there is nothing to write.
    return "a set or insert needs a value";
  }
  return undefined;
}

function editError(
  index: number,
  path: ConfigEditPath,
  message: string,
): ConfigError {
  const issue = formatConfigIssue({ path, message });
  return new ConfigError(
    "CONFIG_INVALID",
    `Cannot apply config edit ${index + 1}:\n${issue}`,
    issue,
  );
}

function applyEdit(text: string, edit: ConfigEdit, style: Style): string {
  // Each edit leaves valid JSONC behind, so every edit after the first parses its predecessor's
  // result as cleanly as the check above parsed the input.
  const root = parseTree(text, [], { allowTrailingComma: true })!;
  if (edit.op === "remove") {
    return removeAt(text, root, edit.path);
  }
  if (edit.op === "insert") {
    const container = findNodeAtLocation(root, edit.path.slice(0, -1));
    const index = edit.path.at(-1) as number;
    if (container?.type !== "array") {
      throw new EditProblem("an insert needs a list to insert into");
    }
    const members = container.children ?? [];
    if (index > members.length) {
      throw new EditProblem(
        `the list has ${members.length} elements, so nothing can go before element ${index}`,
      );
    }
    return index === members.length
      ? appendMember(text, container, (indent) =>
          valueText(edit.value, indent, style),
        )
      : insertBefore(text, members[index]!, edit.value, style);
  }
  return setAt(text, root, { path: edit.path, value: edit.value }, style);
}

function setAt(
  text: string,
  root: Node,
  { path, value }: { path: ConfigEditPath; value: unknown },
  style: Style,
): string {
  const existing = findNodeAtLocation(root, path);
  if (existing !== undefined) {
    // Written on one line if what it replaces was, so a compact entry stays compact.
    const indent =
      existing.length > 0 &&
      text
        .slice(existing.offset, existing.offset + existing.length)
        .includes("\n")
        ? lineIndent(text, existing.offset)
        : undefined;
    return splice(
      text,
      existing.offset,
      existing.offset + existing.length,
      valueText(value, indent, style),
    );
  }

  // The deepest part of the path that exists, and what is missing below it.
  let depth = path.length - 1;
  let parent = findNodeAtLocation(root, path.slice(0, depth));
  while (parent === undefined) {
    depth -= 1;
    parent = findNodeAtLocation(root, path.slice(0, depth));
  }
  const segment = path[depth]!;
  const nested = nestedValue(path.slice(depth + 1), value);
  if (parent.type === "object") {
    if (typeof segment !== "string") {
      throw new EditProblem("an index cannot name a property of an object");
    }
    return appendMember(
      text,
      parent,
      (indent) =>
        `${JSON.stringify(segment)}: ${valueText(nested, indent, style)}`,
    );
  }
  if (parent.type === "array") {
    const length = parent.children?.length ?? 0;
    if (typeof segment !== "number") {
      throw new EditProblem("a name cannot pick an element of a list");
    }
    if (segment !== length) {
      throw new EditProblem(
        `the list has ${length} elements, so there is no element ${segment} to set`,
      );
    }
    return appendMember(text, parent, (indent) =>
      valueText(nested, indent, style),
    );
  }
  throw new EditProblem(`a ${parent.type} value has nothing inside it to set`);
}

// The value to write for the part of a path that does not exist yet: objects for names, and a
// one-element list for an index of 0, the only index a list that does not exist yet can have.
function nestedValue(rest: ConfigEditPath, value: unknown): unknown {
  if (rest.length === 0) {
    return value;
  }
  const [segment, ...below] = rest;
  if (typeof segment === "number") {
    if (segment !== 0) {
      throw new EditProblem(
        `a list that does not exist yet has no element ${segment}`,
      );
    }
    return [nestedValue(below, value)];
  }
  return { [segment!]: nestedValue(below, value) };
}

// Where removing a member that starts its line stops: past the line break after its separator (and
// any comment trailing it there), else past its comma, else at the member's own end.
function wholeLineRemovalEnd(
  after: ReturnType<typeof scanAfter>,
  end: number,
): number {
  if (after.lineBreak !== undefined) {
    return after.lineBreak.offset + after.lineBreak.length;
  }
  return after.comma !== undefined ? after.comma + 1 : end;
}

function removeAt(text: string, root: Node, path: ConfigEditPath): string {
  const found = findNodeAtLocation(root, path);
  if (found === undefined) {
    return text;
  }
  // A property is removed as a whole, name and value together.
  const member = found.parent?.type === "property" ? found.parent : found;
  const container = member.parent!;
  const members = container.children ?? [];
  const index = members.indexOf(member);
  const previous = members[index - 1];
  const next = members[index + 1];
  const end = member.offset + member.length;
  const after = scanAfter(text, end);

  if (startsLine(text, member.offset)) {
    // The member's whole lines go: from the start of its first line through the line break after its
    // separator and any comment trailing it there.
    const start = lineStart(text, member.offset);
    const stop = wholeLineRemovalEnd(after, end);
    const edits: TextEdit[] = [
      { offset: start, length: stop - start, content: "" },
    ];
    // The last member had no comma of its own, so the one after the member before it now separates
    // nothing. It is removed alone; the comment that may trail it stays.
    if (
      next === undefined &&
      after.comma === undefined &&
      previous !== undefined
    ) {
      const previousComma = scanAfter(
        text,
        previous.offset + previous.length,
      ).comma;
      if (previousComma !== undefined) {
        edits.push({ offset: previousComma, length: 1, content: "" });
      }
    }
    return applyTextEdits(text, edits);
  }

  // A member on a line shared with others: it goes with one separator and the space beside it.
  if (next !== undefined) {
    return splice(text, member.offset, next.offset, "");
  }
  if (previous !== undefined) {
    return splice(text, previous.offset + previous.length, end, "");
  }
  return splice(text, member.offset, end, "");
}

/**
 * Add a member after a container's last one, laid out like the others: on a line of its own when
 * they each start a line, joining the line when they share one. `member` renders the member for an
 * indentation, or for one line when given `undefined`.
 */
function appendMember(
  text: string,
  container: Node,
  member: (indent: string | undefined) => string,
): string {
  const members = container.children ?? [];
  const eol = detectNewline(text);
  const containerIndent = lineIndent(text, container.offset);
  const close = container.offset + container.length - 1;

  if (members.length === 0) {
    const indent = containerIndent + unitOf(text);
    // Whatever is already inside - a comment saying the list is empty, say - stays before the new
    // member; only the blank space before the closing bracket is replaced.
    let insertAt = close;
    while (insertAt > container.offset + 1 && /\s/.test(text[insertAt - 1]!)) {
      insertAt -= 1;
    }
    return splice(
      text,
      insertAt,
      close,
      `${eol}${indent}${member(indent)}${eol}${containerIndent}`,
    );
  }

  const last = members.at(-1)!;
  const lastEnd = last.offset + last.length;
  const after = scanAfter(text, lastEnd);
  if (startsLine(text, last.offset)) {
    const indent = lineIndent(text, last.offset);
    const edits: TextEdit[] = [];
    if (after.comma === undefined) {
      edits.push({ offset: lastEnd, length: 0, content: "," });
    }
    // After the comment that trails the last member on its line, so the comment stays with it.
    const at =
      after.lineBreak?.offset ??
      (after.comma !== undefined ? after.comma + 1 : lastEnd);
    // Spread over lines like the member before it, or kept to one line like it: a list of one-line
    // rule entries gets another one-line entry.
    edits.push({
      offset: at,
      length: 0,
      content: `${eol}${indent}${member(spansLines(text, last) ? indent : undefined)}`,
    });
    return applyTextEdits(text, edits);
  }
  return after.comma !== undefined
    ? splice(text, after.comma + 1, after.comma + 1, ` ${member(undefined)}`)
    : splice(text, lastEnd, lastEnd, `, ${member(undefined)}`);
}

function insertBefore(
  text: string,
  target: Node,
  value: unknown,
  style: Style,
): string {
  if (startsLine(text, target.offset)) {
    // A line of its own directly above the element it goes before; a comment on the lines above
    // that element stays above the pair.
    const indent = lineIndent(text, target.offset);
    const start = lineStart(text, target.offset);
    return splice(
      text,
      start,
      start,
      `${indent}${valueText(value, spansLines(text, target) ? indent : undefined, style)},${style.eol}`,
    );
  }
  return splice(
    text,
    target.offset,
    target.offset,
    `${valueText(value, undefined, style)}, `,
  );
}

/**
 * What follows a member up to the end of its line: its separating comma, if any, and the line break
 * that ends the line - known only when nothing but whitespace and comments stands between, which is
 * what makes that line the member's own.
 */
function scanAfter(
  text: string,
  offset: number,
): { comma?: number; lineBreak?: { offset: number; length: number } } {
  const scanner = createScanner(text, false);
  scanner.setPosition(offset);
  let comma: number | undefined;
  for (;;) {
    const kind = scanner.scan();
    const at = scanner.getTokenOffset();
    if (kind === SyntaxKind.Trivia || kind === SyntaxKind.LineCommentTrivia) {
      continue;
    }
    if (kind === SyntaxKind.BlockCommentTrivia) {
      if (text.slice(at, at + scanner.getTokenLength()).includes("\n")) {
        return { comma };
      }
      continue;
    }
    if (kind === SyntaxKind.CommaToken && comma === undefined) {
      comma = at;
      continue;
    }
    if (kind === SyntaxKind.LineBreakTrivia) {
      return {
        comma,
        lineBreak: { offset: at, length: scanner.getTokenLength() },
      };
    }
    return { comma };
  }
}

function valueText(
  value: unknown,
  indent: string | undefined,
  style: Style,
): string {
  if (indent === undefined) {
    return oneLine(value);
  }
  return JSON.stringify(value, null, style.unit)
    .split("\n")
    .join(style.eol + indent);
}

// JSON on one line, spaced the way such a line is written by hand: `{"rule": "REF-001"}`.
function oneLine(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(oneLine).join(", ")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${oneLine(entry)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}

function lineStart(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && text[start - 1] !== "\n") {
    start -= 1;
  }
  return start;
}

function spansLines(text: string, node: Node): boolean {
  return text.slice(node.offset, node.offset + node.length).includes("\n");
}

function startsLine(text: string, offset: number): boolean {
  return /^[ \t]*$/.test(text.slice(lineStart(text, offset), offset));
}

function lineIndent(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, offset)))![0];
}

const DEFAULT_UNIT = "  ";

function unitOf(text: string): string {
  const indented = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indented === undefined) {
    return DEFAULT_UNIT;
  }
  return indented.startsWith("\t") ? "\t" : indented;
}

function styleOf(text: string): Style {
  return { unit: unitOf(text), eol: detectNewline(text) };
}

function splice(
  text: string,
  start: number,
  end: number,
  content: string,
): string {
  return text.slice(0, start) + content + text.slice(end);
}

// Applied from the end of the text backwards, so an earlier offset is not moved by a later edit. Two
// insertions at one offset land in the order they are listed - a member's comma before the member -
// which means applying the later one first, since each insertion goes in front of what is there.
function applyTextEdits(text: string, edits: TextEdit[]): string {
  return edits
    .map((edit, index) => ({ edit, index }))
    .sort(
      (left, right) =>
        right.edit.offset - left.edit.offset || right.index - left.index,
    )
    .reduce(
      (result, { edit }) =>
        splice(result, edit.offset, edit.offset + edit.length, edit.content),
      text,
    );
}
