import { z } from "zod";

import { compareStrings } from "../../deterministic-sort.js";
import { matchesConfigGlob } from "../../discovery/globs.js";
import type {
  ParsedDocument,
  ParsedTextSpan,
} from "../../markdown/document-types.js";
import { allChecked } from "../primitives/checklist.js";
import { noPlaceholders } from "../primitives/content.js";
import { escapeRegExp } from "../regex.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { createLineNumberLookup, lineStartOffsets } from "../text-position.js";
import type { RuleContext, TextEdit } from "../types.js";
import { imageAltFindings } from "./ctx-image-alt.js";
import {
  DEFAULT_NON_DESCRIPTIVE_LINK_TEXT,
  linkTextFindings,
  normalizeLinkText,
} from "./ctx-link-text.js";
import { reportInertConfiguration } from "./inert.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";

// Content-quality rules.

// CTX-001 — no empty / placeholder sections (whole-body, case-insensitive).
export const ctx001: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-001",
    category: "CTX",
    description: "Sections are not empty or placeholder-only.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      section: z.string().optional(),
      placeholders: z.array(z.string()).optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of noPlaceholders(context.document!, {
      section: options.section,
      placeholders: options.placeholders,
    })) {
      context.report(finding);
    }
  },
});

// CTX-002 — all checklist items checked.
export const ctx002: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-002",
    category: "CTX",
    description: "All checklist items are checked.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({ section: z.string().optional(), ...fileScopeShape })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of allChecked(context.document!, {
      section: options.section,
    })) {
      context.report(finding);
    }
  },
});

// Match a term as a whole word (so "APIs" or "myapi" do not match "api"). Escapes regex-special
// characters in the term. The trailing boundary is a lookahead, not a consumed group: `matchAll`
// advances `lastIndex` past whatever a match consumes, so consuming the boundary character made
// adjacent occurrences separated by exactly one character unreachable — "api api api" then
// under-counted as 2.
function wholeWordRegex(term: string): RegExp {
  const escaped = escapeRegExp(term);
  return new RegExp(`(^|[^A-Za-z0-9_])(${escaped})(?=[^A-Za-z0-9_]|$)`, "g");
}

// Name the stage of the glossary load that produced no aliases, so the report says which of the
// three things to go and fix rather than that something is wrong. Ordered outermost-first: a
// glossary that was never read cannot be missing a column, and a column that is absent cannot hold
// an empty cell, so the first condition that holds is the only actionable one.
//
// Each message is a single line. The text report's grammar is one finding per line, so an embedded
// newline splits a message into rows that read as findings in files that do not exist.
function describeEmptyGlossary(params: {
  glossary: string;
  termColumn: string;
  aliasColumn: string;
  matchedGlossaries: number;
  termTables: number;
}): string {
  if (params.matchedGlossaries === 0) {
    // Names the scan rather than the disk: the glossary is read from the parsed corpus, so a file
    // that exists but sits outside `include` (or inside `exclude`) is as absent as one that was
    // never written, and a user staring at the file in their editor needs to be told that.
    return `CTX-003 glossary "${params.glossary}" matched no scanned document, so no aliases were loaded; skipping alias checks. A file outside "include" or inside "exclude" is not scanned even when it exists on disk.`;
  }
  if (params.termTables === 0) {
    return `CTX-003 found no table with a "${params.termColumn}" column in glossary "${params.glossary}", so no aliases were loaded; skipping alias checks.`;
  }
  return `CTX-003 derived no aliases from glossary "${params.glossary}": no "${params.termColumn}" table has a non-empty "${params.aliasColumn}" column; skipping alias checks.`;
}

type Ctx003Options = {
  glossary: string;
  termColumn: string;
  aliasColumn?: string;
  section?: string;
  files?: string[];
  exclude?: string[];
};

type AliasMap = {
  aliasToCanonical: Map<string, string>;
  // Counted so an empty alias map can name which stage of the load came up empty. Without them
  // the three failures are indistinguishable at the point they have to be reported.
  matchedGlossaries: number;
  termTables: number;
};

function loadAliasMap(
  options: Ctx003Options,
  aliasColumn: string,
  documents: Map<string, ParsedDocument>,
): AliasMap {
  const aliasToCanonical = new Map<string, string>();
  let matchedGlossaries = 0;
  let termTables = 0;

  for (const document of documents.values()) {
    if (!matchesConfigGlob(document.path, [options.glossary])) {
      continue;
    }
    matchedGlossaries += 1;
    for (const table of document.tables) {
      if (!table.headers.includes(options.termColumn)) {
        continue;
      }
      termTables += 1;
      for (const row of table.rows) {
        const canonical = (row.cells[options.termColumn] ?? "").trim();
        if (canonical.length === 0) {
          continue;
        }
        for (const alias of (row.cells[aliasColumn] ?? "").split(/\s*,\s*/)) {
          const trimmed = alias.trim();
          if (trimmed.length > 0 && trimmed !== canonical) {
            aliasToCanonical.set(trimmed, canonical);
          }
        }
      }
    }
  }

  return { aliasToCanonical, matchedGlossaries, termTables };
}

// The [start, end) offsets of `content` CTX-003 scans: the whole file, or the body of each section
// named `section` — the lines after its heading up to the next heading of the same or a shallower
// depth, the same extent `extractSectionBody` gives. Offsets rather than an extracted body, so a
// match is located in the source itself and can be both reported and rewritten. The `\r` of a CRLF
// line stays in the scanned text; it is a non-word character to `wholeWordRegex`, exactly like the
// `\n` beside it, so it changes neither what matches nor on which line.
function scanRanges(
  document: ParsedDocument,
  section: string | undefined,
): { start: number; end: number }[] {
  const content = document.content;
  if (section === undefined) {
    return [{ start: 0, end: content.length }];
  }
  const offsets = lineStartOffsets(content);
  const lineStart = (line: number) => offsets[line - 1] ?? content.length;
  return document.headings
    .filter((heading) => heading.text === section)
    .map((heading) => {
      const next = document.headings.find(
        (candidate) =>
          candidate.line > heading.line && candidate.depth <= heading.depth,
      );
      return {
        start: lineStart(heading.line + 1),
        end: next === undefined ? content.length : lineStart(next.line),
      };
    });
}

type AliasMatch = {
  start: number;
  end: number;
  alias: string;
  canonical: string;
  line: number;
  fixable: boolean;
};

// Every link fragment in the corpus, folded with `toLowerCase` (never `toLocaleLowerCase`, whose
// result depends on the host's ICU data and locale). Folded because REF-002's fix rewrites a
// case-only mismatch such as `#GQL` to the exact slug `gql` in the same `--fix` run, so a heading
// whose slug matches a fragment only ignoring case is about to become a link target. Read from
// every link without resolving which file it points at: the graph has no edge for a fragment that
// does not resolve exactly, and resolving paths here would be a second link resolver. Matching a
// fragment that actually targets another file only withholds a heading rewrite, which is the safe
// direction. Memoised per corpus because CTX-003 asks once per document.
const foldedFragmentsByCorpus = new WeakMap<
  Map<string, ParsedDocument>,
  Set<string>
>();
function foldedLinkFragments(
  documents: Map<string, ParsedDocument>,
): Set<string> {
  let folded = foldedFragmentsByCorpus.get(documents);
  if (folded === undefined) {
    folded = new Set();
    for (const document of documents.values()) {
      for (const link of document.links) {
        if (link.anchor !== undefined && link.anchor.length > 0) {
          folded.add(link.anchor.toLowerCase());
        }
      }
    }
    foldedFragmentsByCorpus.set(documents, folded);
  }
  return folded;
}

// A term written only with letters, digits, spaces and `.,'’-/+`, opening and closing with a
// letter or digit. Every other character can be Markdown syntax where it lands — `|` splits a
// table cell, `*`/`_`/`~` pair into emphasis, `[`, `]`, `<`, `` ` ``, `&` and `\` open links, HTML,
// code, entities and escapes, `:` and `@` complete an autolink — so a canonical term containing one
// would write syntax into the source, and an alias containing one would remove it. The letter or
// digit at each end matters too: whether an emphasis delimiter beside the term pairs depends on
// whether the character next to it is punctuation. Both sides of a substitution must pass.
const PLAIN_TERM = /^[\p{L}\p{N}](?:[\p{L}\p{N} .,'’\-/+]*[\p{L}\p{N}])?$/u;
// A canonical term that would open an ordered list when the alias starts a line.
const LIST_MARKER_SHAPE = /^\p{N}+\.\s/u;
// What makes GFM read a run of text as a link with no link syntax at all: a `www.` domain, a
// `scheme://` URL, or an email or `mailto:`/`xmpp:` address around an `@`.
const AUTOLINK_LITERAL_TRIGGER = /www\.|:\/\/|@/i;

// Whether replacing `match` leaves every byte around it parsed in the same role. The substitution
// is byte-exact, but Markdown is read from context, so a byte-exact rewrite can still turn text into
// a link, a table column or emphasis. Three ways, each checked:
//
// - The characters of the alias and of the canonical term (see `PLAIN_TERM`).
// - Literal brackets around the match. `[gql]` with no `[gql]: …` definition is plain text, but
//   `[GraphQL]` is a link once a `[graphql]: …` definition exists, and a definition REF-009 would
//   otherwise delete as unused suddenly has a user. So a match between a literal `[` and a literal
//   `]` with no paragraph break between them is never rewritten, whatever the definitions are
//   today. Only brackets the parse left as text count (`literalBrackets`): the brackets of a real
//   link are syntax already, and its text is ordinary prose.
// - The whitespace-delimited token the match sits in. `user@gql` is text, but with the alias
//   replaced by a term containing a dot it can become an email autolink; any token GFM could read
//   as an autolink literal is left alone.
//
// Each condition depends only on the match, its canonical term and bytes no accepted rewrite can
// change, so an occurrence withheld here is withheld again on the next run.
function keepsParsedRole(document: ParsedDocument, match: AliasMatch): boolean {
  if (
    !PLAIN_TERM.test(match.alias) ||
    !PLAIN_TERM.test(match.canonical) ||
    LIST_MARKER_SHAPE.test(match.canonical)
  ) {
    return false;
  }
  const content = document.content;

  const brackets = document.literalBrackets;
  let after = 0;
  while (after < brackets.length && brackets[after]! < match.end) {
    after += 1;
  }
  const opener = brackets[after - 1];
  const closer = brackets[after];
  if (
    opener !== undefined &&
    closer !== undefined &&
    opener < match.start &&
    content[opener] === "[" &&
    content[closer] === "]" &&
    !/\n[ \t]*\r?\n/.test(content.slice(opener, closer))
  ) {
    return false;
  }

  let tokenStart = match.start;
  while (tokenStart > 0 && !/\s/.test(content[tokenStart - 1]!)) {
    tokenStart -= 1;
  }
  let tokenEnd = match.end;
  while (tokenEnd < content.length && !/\s/.test(content[tokenEnd]!)) {
    tokenEnd += 1;
  }
  return !AUTOLINK_LITERAL_TRIGGER.test(
    content.slice(tokenStart, match.start) +
      match.canonical +
      content.slice(match.end, tokenEnd),
  );
}

// Every alias occurrence CTX-003 reports in `document`, in report order, each marked with whether
// `--fix` may replace it. Check and fix both read this one list, so the fix rewrites exactly the
// findings the report marked fixable. A match is fixable only when every one of these holds:
//
// - It lies wholly inside one prose text span from the parse. Code spans and blocks, HTML, link
//   and definition targets, autolinks and front matter are never such spans, and neither is the
//   text of a shortcut `[label]` or collapsed `[label][]` reference — it is the label that finds the
//   definition, so rewriting it would break the link — nor text written with escapes or entities,
//   whose offsets would not survive the substitution.
// - The substitution keeps every byte around it in the same parsed role (`keepsParsedRole`): the
//   alias and the canonical term are plain text, and the match is not inside literal brackets or an
//   autolink-shaped token.
// - It is not in a heading of a document where any heading slug is, ignoring case, the fragment of
//   some link in the corpus. Rewriting a heading changes its slug and can shift the `-1` suffix of
//   a later heading with the same text, so the only heading rewrite that cannot break a link is
//   one in a document no fragment points into.
// - It wins overlap resolution within its span: the earliest start, then at the same start the
//   longer alias, then the alphabetically earlier one. One rewrite per region per run.
// - Its span passes as a whole. The span's winning replacements are applied together and the
//   result is scanned again; if any alias now matches across or inside a replaced region — a
//   canonical that contains an alias, or replacements that together spell one (`foo baz` becoming
//   `bar qux` when `bar qux` is itself an alias) — no match in that span is fixable. Judging the
//   span as a unit is what makes a second `--fix` a no-op: a rejected span is left byte-identical,
//   so the next run sees the same text and decides the same way, and an accepted span afterwards
//   holds no alias except ones withheld by the conditions above, which no accepted rewrite can
//   change. Judging each replacement alone cannot promise either, because a neighbour's rewrite
//   changes the text the next run judges it against.
function collectAliasMatches(
  document: ParsedDocument,
  section: string | undefined,
  aliasToCanonical: Map<string, string>,
  documents: Map<string, ParsedDocument>,
): AliasMatch[] {
  const content = document.content;
  const lineAt = createLineNumberLookup(content);
  // Asked only once a match falls in a heading: the first answer walks every link in the corpus,
  // and most documents have no alias in a heading at all.
  let headingsLinked: boolean | undefined;
  const isHeadingLinked = (): boolean => {
    if (headingsLinked === undefined) {
      const fragments = foldedLinkFragments(documents);
      headingsLinked = document.headings.some((heading) =>
        fragments.has(heading.slug.toLowerCase()),
      );
    }
    return headingsLinked;
  };
  const matches: AliasMatch[] = [];

  for (const range of scanRanges(document, section)) {
    const text = content.slice(range.start, range.end);
    for (const [alias, canonical] of aliasToCanonical) {
      for (const match of text.matchAll(wholeWordRegex(alias))) {
        const start = range.start + (match.index ?? 0) + match[1]!.length;
        matches.push({
          start,
          end: start + alias.length,
          alias,
          canonical,
          line: lineAt(start),
          fixable: false,
        });
      }
    }
  }

  const candidatesBySpan = new Map<ParsedTextSpan, AliasMatch[]>();
  for (const match of matches) {
    const span = document.textSpans.find(
      (candidate) =>
        candidate.start <= match.start && match.end <= candidate.end,
    );
    if (
      span === undefined ||
      !keepsParsedRole(document, match) ||
      (span.headingSlug !== undefined && isHeadingLinked())
    ) {
      continue;
    }
    const spanCandidates = candidatesBySpan.get(span) ?? [];
    spanCandidates.push(match);
    candidatesBySpan.set(span, spanCandidates);
  }

  for (const [span, spanCandidates] of candidatesBySpan) {
    const ordered = [...spanCandidates].sort(
      (left, right) =>
        left.start - right.start ||
        right.end - right.start - (left.end - left.start) ||
        compareStrings(left.alias, right.alias),
    );
    const winners: AliasMatch[] = [];
    for (const match of ordered) {
      if (match.start >= (winners[winners.length - 1]?.end ?? -1)) {
        winners.push(match);
      }
    }

    // Rebuild the span with every winner applied, remembering where each canonical term landed.
    let replaced = "";
    let cursor = span.start;
    const landed: { start: number; end: number }[] = [];
    for (const winner of winners) {
      replaced += content.slice(cursor, winner.start);
      landed.push({
        start: replaced.length,
        end: replaced.length + winner.canonical.length,
      });
      replaced += winner.canonical;
      cursor = winner.end;
    }
    replaced += content.slice(cursor, span.end);

    const createsAlias = [...aliasToCanonical.keys()].some((alias) =>
      [...replaced.matchAll(wholeWordRegex(alias))].some((found) => {
        const foundStart = (found.index ?? 0) + found[1]!.length;
        const foundEnd = foundStart + alias.length;
        return landed.some(
          (region) => foundStart < region.end && foundEnd > region.start,
        );
      }),
    );
    if (!createsAlias) {
      for (const winner of winners) {
        winner.fixable = true;
      }
    }
  }

  return matches;
}

// CTX-003 — glossary alias usage should use the canonical term (project). Builds alias→canonical
// from a glossary table, then scans matched files' content for alias usage. Fixable: the alias
// bytes are replaced by the canonical term, under the conditions `collectAliasMatches` lists. A
// project rule fixes by being handed each document in turn, and the alias map it would rebuild for
// every one of them is memoised per corpus.
export const ctx003: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-003",
    category: "CTX",
    description: "Content uses canonical glossary terms instead of aliases.",
    defaultSeverity: "warning",
    scope: "project",
    fixable: true,
  },
  optionsSchema: z
    .object({
      glossary: z.string().min(1),
      termColumn: z.string().min(1),
      aliasColumn: z.string().min(1).optional(),
      section: z.string().optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    // `aliasColumn` is optional in the schema but load-bearing at run time: with no alias column
    // there is no alias to look for, so the rule can never report anything. Answered before the
    // corpus walk because it is decidable from the options alone, and because it is the cause to
    // name even when the glossary path is also wrong — fixing the path would not make this config
    // check anything.
    if (options.aliasColumn === undefined) {
      reportInertConfiguration(context, {
        message: `CTX-003 has no "aliasColumn", so it can never derive an alias to check; skipping alias checks.`,
        configValue: options.glossary,
        data: { glossary: options.glossary, termColumn: options.termColumn },
      });
      return;
    }
    const aliasColumn = options.aliasColumn;
    const { aliasToCanonical, matchedGlossaries, termTables } = loadAliasMap(
      options,
      aliasColumn,
      context.documents!,
    );

    // An empty alias map used to be a bare `return`: a configured rule, inert, and green, with
    // nothing anywhere distinguishing "this corpus uses canonical terms" from "this rule never ran"
    // — reachable by renaming the glossary file or a column header, neither of which invalidates
    // the config. All the ways to get here are reported as one error-severity finding attributed to
    // the `glossary` value, naming the stage that came up empty.
    //
    // Other rules take an option that names a corpus path and go quiet the same way when it matches
    // nothing (LLM-001's `entrypoints`, REF-005/REF-006's `definitions` and `references`, REF-004's
    // `zonesDir`, GRP-003's `chain[].files`). The reporting shape generalizes and lives in
    // `reportInertConfiguration`, but the decision to use it does not: for those options an empty
    // match can be a legitimate state (a corpus with no definitions yet), whereas a glossary rule
    // with no glossary cannot be. Converting one means deciding, per rule, whether emptiness is a
    // configuration mistake or a valid corpus — a judgment with its own tests, not a sweep.
    if (aliasToCanonical.size === 0) {
      reportInertConfiguration(context, {
        message: describeEmptyGlossary({
          glossary: options.glossary,
          termColumn: options.termColumn,
          aliasColumn,
          matchedGlossaries,
          termTables,
        }),
        configValue: options.glossary,
        data: {
          glossary: options.glossary,
          termColumn: options.termColumn,
          aliasColumn,
        },
      });
      return;
    }

    for (const document of context.documents!.values()) {
      if (!isAliasScanned(document.path, options)) {
        continue;
      }
      for (const match of collectAliasMatches(
        document,
        options.section,
        aliasToCanonical,
        context.documents!,
      )) {
        context.report({
          message: `Use canonical term "${match.canonical}" instead of alias "${match.alias}".`,
          line: match.line,
          filePath: document.path,
          ...(match.fixable ? { fixable: true } : {}),
          data: { alias: match.alias, canonical: match.canonical },
        });
      }
    }
  },
  fix: (options) => {
    // Keyed by the corpus map: `applyFixes` hands every document the same `documents`, so the
    // glossary is read once per `--fix` run rather than once per document. A WeakMap so a finished
    // run's corpus is not kept alive by the resolved rule.
    const aliasMaps = new WeakMap<Map<string, ParsedDocument>, AliasMap>();
    return (context: RuleContext): TextEdit[] => {
      const aliasColumn = options.aliasColumn;
      const document = context.document!;
      if (
        aliasColumn === undefined ||
        !isAliasScanned(document.path, options)
      ) {
        return [];
      }
      const documents = context.documents!;
      let aliasMap = aliasMaps.get(documents);
      if (aliasMap === undefined) {
        aliasMap = loadAliasMap(options, aliasColumn, documents);
        aliasMaps.set(documents, aliasMap);
      }
      return collectAliasMatches(
        document,
        options.section,
        aliasMap.aliasToCanonical,
        documents,
      ).flatMap((match) =>
        match.fixable
          ? [{ start: match.start, end: match.end, newText: match.canonical }]
          : [],
      );
    };
  },
});

// Never flag the glossary itself — its alias column is where aliases are supposed to be written —
// and honor file scoping. Shared by check and fix so `--fix` rewrites no file the check skipped.
function isAliasScanned(filePath: string, options: Ctx003Options): boolean {
  return (
    !matchesConfigGlob(filePath, [options.glossary]) &&
    matchesFileScope(filePath, options)
  );
}

// A phrase with no letter or digit normalises to "" (edge punctuation is trimmed) and could never
// match any link, so config rejects it at load rather than leaving an entry that silently does
// nothing. No `g` flag: a shared `g`-flagged RegExp carries `lastIndex` between `test` calls.
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const linkTextPhraseSchema = z
  .string()
  .refine((value) => HAS_LETTER_OR_DIGIT.test(value), {
    message: "a link-text phrase must contain a letter or digit",
  });

// CTX-004 — link text describes its target. An agent, like a reader scanning a page, decides whether
// to follow a link from its text alone, and "here" or "подробнее" says nothing about the target.
// The comparison is on the whole normalised text, so a listed word inside a longer descriptive
// phrase is fine. `phrases` replaces the default list and `additionalPhrases` extends whichever list
// is in effect — unlike CTX-001's `placeholders`, which can only extend — because a project in
// another language needs to drop the English and Russian defaults, not just add to them. `phrases`
// has `.min(1)` so an empty list cannot turn the rule into a silent no-op. Defaults are applied with
// `??` rather than a Zod `.default()`, matching SEC-003 to SEC-006, so the generated schema keeps
// every option optional. Not fixable: choosing descriptive text is a judgment call.
export const ctx004: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-004",
    category: "CTX",
    description: "Link text describes its target.",
    // Writing hygiene meant to be enabled bare across a corpus, so a warning is proportionate.
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      phrases: z.array(linkTextPhraseSchema).min(1).optional(),
      additionalPhrases: z.array(linkTextPhraseSchema).optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => {
    // Normalised once per configured rule rather than once per document: the list is fixed for the
    // run, and both sides must go through the same normalisation to compare at all.
    const phrases = new Set(
      [
        ...(options.phrases ?? DEFAULT_NON_DESCRIPTIVE_LINK_TEXT),
        ...(options.additionalPhrases ?? []),
      ].map(normalizeLinkText),
    );
    return (context) => {
      if (!matchesFileScope(context.filePath!, options)) {
        return;
      }
      for (const finding of linkTextFindings(context.document!, { phrases })) {
        context.report(finding);
      }
    };
  },
});

// CTX-005 — images have alt text. A model does not see an image, so its alt text is all of it that
// reaches the context; an image with none is a hole in what the model reads. Only empty or
// whitespace-only alt is reported, never a judgment of how good a description is, so the rule takes
// no options beyond file scope. Not fixable: writing a description is a judgment call.
export const ctx005: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-005",
    category: "CTX",
    description: "Images have alt text.",
    // Writing hygiene meant to be enabled bare across a corpus, so a warning is proportionate.
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z.object({ ...fileScopeShape }).strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of imageAltFindings(context.document!)) {
      context.report(finding);
    }
  },
});

export const CTX_RULES: readonly RuleDefinition[] = [
  ctx001,
  ctx002,
  ctx003,
  ctx004,
  ctx005,
];
