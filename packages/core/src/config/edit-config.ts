import {
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";

import { detectNewline } from "../markdown/newline.js";
import { ConfigError } from "./config-error.js";
import { formatConfigIssue } from "./config-issues.js";

// Targeted edits to the text of a JSONC config, for a host that lets a user change the config one
// value at a time. The config carries its rationale as comments — why a glob is excluded, why a
// budget is what it is — and a parse-and-rebuild through `JSON.stringify`, which is how `init`
// merges, would silently delete every one of them. Editing the text in place keeps every comment
// and every byte outside the object being changed; only a comment *inside* a replaced or removed
// value goes with it, because it described what is no longer there. The object an edit lands in is
// laid out again by jsonc-parser's formatter, so a one-line rule entry that gains a key spreads over
// several lines; its neighbors keep the layout they were written in.

export type ConfigEditPath = (string | number)[];

export type ConfigEdit =
  // Create or replace the value at `path`, creating the objects above it when they are missing.
  | { op: "set"; path: ConfigEditPath; value: unknown }
  // Remove the property or array element at `path`; nothing there is not an error.
  | { op: "remove"; path: ConfigEditPath }
  // Insert into the array the path ends in, before the element at that index; the array's length
  // appends.
  | { op: "insert"; path: ConfigEditPath; value: unknown };

/**
 * Apply `edits` to config text in order, each against the text the previous one produced, so a path
 * names what is there after the edits before it (removing `rules[2]` moves `rules[3]` to index 2).
 *
 * New text is indented like the file — tabs, or the width of its first indented line — and uses the
 * file's own newline, detected from its bytes rather than the platform, so an edit to a CRLF config
 * on Linux does not leave it with mixed endings. Deterministic: the same text and edits always give
 * the same bytes. The result is not validated here; `parseConfiguration` is what decides whether it
 * is a config.
 */
export function editConfigText(
  text: string,
  edits: readonly ConfigEdit[],
): string {
  const errors: ParseError[] = [];
  parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    // jsonc-parser edits a broken document on a best guess; writing that guess back could turn a
    // typo into a config that parses and means something else.
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

  const formattingOptions = formattingOf(text);
  let result = text;
  edits.forEach((edit, index) => {
    const problem = checkEdit(edit);
    if (problem !== undefined) {
      throw editError(index, edit.path, problem);
    }
    try {
      result = applyEdits(
        result,
        modify(
          result,
          edit.path,
          edit.op === "remove" ? undefined : edit.value,
          {
            formattingOptions,
            isArrayInsertion: edit.op === "insert",
          },
        ),
      );
    } catch (error) {
      // jsonc-parser throws when a path runs through a value of the wrong kind, such as an index into
      // an object; the edit is the caller's mistake, reported against its own path.
      throw editError(index, edit.path, (error as Error).message);
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
    // `modify` reads an undefined value as a removal, which is not what a set or insert asked for.
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

const DEFAULT_INDENT = 2;

function formattingOf(text: string): FormattingOptions {
  const indented = /^([ \t]+)\S/m.exec(text)?.[1];
  return {
    insertSpaces: indented === undefined || !indented.startsWith("\t"),
    tabSize:
      indented === undefined || indented.startsWith("\t")
        ? DEFAULT_INDENT
        : indented.length,
    eol: detectNewline(text),
  };
}
