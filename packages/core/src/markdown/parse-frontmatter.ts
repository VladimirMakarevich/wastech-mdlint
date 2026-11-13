import { isScalar, LineCounter, parseDocument, visit } from "yaml";

import type {
  FrontmatterParseResult,
  FrontmatterValue,
} from "./document-types.js";

// The one place core turns front matter text into a value. Kept in its own module, and called only
// from the parse pass, so every reader (FM-001, the `frontmatter*` custom kinds) sees one parse of
// one block, and the YAML library can be swapped without touching a rule.

// Upper bound on alias dereferences while converting to plain data. An alias chain that fans out
// (the "billion laughs" shape) expands exponentially; front matter has no legitimate need for more
// than a handful of aliases, so a document over this bound is reported invalid instead of hanging
// or exhausting memory.
const MAX_ALIAS_COUNT = 100;

// Parse the raw block (fences excluded, LF-normalised) into a plain value or a structured error.
// `startLine` is the 1-based line of the opening fence, so raw line 1 is file line `startLine + 1`.
//
// Parser settings, each closing off a way YAML can surprise a schema check:
// - `failsafe` schema: every scalar stays a string, with no type resolution. `version: 1.10` stays
//   "1.10" rather than becoming the number 1.1, `enabled: yes` stays "yes", and nothing turns into a
//   Date. Allowed-value and pattern checks then compare against the parsed string with no YAML type
//   rules for a user to learn. It is not always the source text: YAML's string syntax still applies,
//   so quotes are removed, escapes decoded, and a `|`/`>` block scalar keeps its final newline
//   unless written `|-`/`>-`. The cost is that `true` and "true" are indistinguishable, which is
//   fine for checks that only ever compare strings.
// - `merge: false`: `<<` is an ordinary key, so a document cannot silently pull keys in from
//   elsewhere in the block.
// - `uniqueKeys: true`: a repeated key is an error rather than last-one-wins.
// - `prettyErrors: false`: a pretty error embeds a multi-line code frame, and every finding message
//   must stay on one line because the text report is one finding per line.
// - No custom tags are registered, so `!anything` (and any core-schema tag such as `!!int`, which
//   failsafe does not know) is an unresolved-tag warning. Nothing is constructed from a tag, let
//   alone executed.
export function parseFrontmatterYaml(
  raw: string,
  startLine: number,
): FrontmatterParseResult {
  const lineCounter = new LineCounter();
  const document = parseDocument(raw, {
    schema: "failsafe",
    merge: false,
    uniqueKeys: true,
    prettyErrors: false,
    lineCounter,
  });

  const toFileLine = (offset: number): number =>
    startLine + lineCounter.linePos(offset).line;

  // Warnings count as failures too: each one means the parser had to guess (an unresolved tag
  // became a plain string, a second document was ignored), and a guessed value checked against a
  // schema would pass or fail for reasons the author cannot see. Earliest by position, so the
  // reported line is the first thing to fix and does not depend on the parser's internal order.
  const problems = [...document.errors, ...document.warnings].sort(
    (left, right) => left.pos[0] - right.pos[0],
  );
  const first = problems[0];
  if (first !== undefined) {
    return {
      ok: false,
      error: {
        message: firstLine(first.message),
        line: toFileLine(first.pos[0]),
      },
    };
  }

  // A collection or alias used as a mapping key cannot become a plain-object key: `toJS` would
  // stringify it and emit a process warning on stderr, so a lint run would write noise outside its
  // report. Rejected here as invalid instead, at the key's own line.
  let complexKeyOffset: number | undefined;
  visit(document, {
    Pair(_, pair) {
      if (pair.key !== null && !isScalar(pair.key)) {
        const node = pair.key as { range?: [number, number, number] };
        complexKeyOffset = node.range?.[0] ?? 0;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  if (complexKeyOffset !== undefined) {
    return {
      ok: false,
      error: {
        message: "Mapping keys must be plain scalars",
        line: toFileLine(complexKeyOffset),
      },
    };
  }

  try {
    // `toJS` defines each key as an own property, so a `__proto__:` key is ordinary data and never
    // reaches `Object.prototype`.
    const value = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) as
      | FrontmatterValue
      | undefined;
    return { ok: true, value: value ?? null };
  } catch (error) {
    // The only expected throw is the alias bound above. It is reported at the opening fence because
    // the expansion has no single offending line.
    return {
      ok: false,
      error: {
        message: firstLine(
          error instanceof Error ? error.message : String(error),
        ),
        line: startLine,
      },
    };
  }
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0]!.trim();
}
