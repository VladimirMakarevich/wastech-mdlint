import type { ParsedDocument } from "../../markdown/document-types.js";
import type { PrimitiveFinding } from "../primitives/types.js";

// Non-descriptive link text check for CTX-004. Pure over the parsed document, so it needs no
// filesystem to test. Options arrive with defaults applied and every phrase already normalised.
export type LinkTextOptions = {
  phrases: ReadonlySet<string>;
};

// Text that says only "there is a link here" and nothing about where it goes. English and Russian
// are both shipped because both are common in the documentation this tool is run over; a project
// writing in another language replaces or extends the list through config.
export const DEFAULT_NON_DESCRIPTIVE_LINK_TEXT: readonly string[] = [
  "here",
  "click here",
  "click",
  "link",
  "this link",
  "more",
  "read more",
  "learn more",
  "this",
  "this page",
  "здесь",
  "тут",
  "сюда",
  "ссылка",
  "по ссылке",
  "эта ссылка",
  "подробнее",
  "читать далее",
  "нажмите здесь",
];

// None of these carries the `g` flag. A shared `g`-flagged RegExp keeps `lastIndex` between calls,
// so a `test` on one link would start mid-string on the next and the findings would depend on which
// documents ran before. Each pattern here matches at most once per string, so the flag buys nothing.
const WHITESPACE_RUN = /\s+/u;
const LEADING_PUNCTUATION = /^[\p{P}\p{S}\s]+/u;
const TRAILING_PUNCTUATION = /[\p{P}\p{S}\s]+$/u;

// Puts the text in NFC form, collapses whitespace runs and trims punctuation, symbols and space
// from both ends, keeping the author's casing. NFC first, so a letter typed as a base letter plus a
// combining mark (`й` as `и` + U+0306) compares equal to the precomposed form a phrase list holds. Link text may wrap across source lines (`[click\nhere](a.md)`), and a finding's
// message has to stay on one line because the text report prints one finding per line. Edge
// punctuation goes so that `here.`, `«здесь»`, `(link)` and `read more →` match their bare phrase;
// punctuation inside the text stays, so `here-and-there` is not `here and there`.
function displayLinkText(value: string): string {
  return value
    .normalize("NFC")
    .split(WHITESPACE_RUN)
    .join(" ")
    .replace(LEADING_PUNCTUATION, "")
    .replace(TRAILING_PUNCTUATION, "");
}

// The comparison key for link text and for configured phrases alike, so a phrase written as
// `Click Here!` in config matches `[click here](a.md)`. `toLowerCase`, never `toLocaleLowerCase`:
// the locale variant depends on the host's default locale (a Turkish host lower-cases `I` to a
// dotless `ı`), and the same document must produce the same findings on every machine. The
// locale-independent mapping already lower-cases Cyrillic.
export function normalizeLinkText(value: string): string {
  return displayLinkText(value).toLowerCase();
}

// Only the link's own visible text decides; its target never does. That one rule settles every edge
// case without a special branch:
//
// - Raw inline HTML in the label is markup, not text: `[<em>here</em>](a.md)` reads as "here" and
//   is reported. The parser's `visibleText` already drops the tags (an inline `<br>` becomes
//   whitespace, so `[click<br>here](a.md)` reads as "click here"); `text` keeps them for the graph.
// - Autolinks (`<https://…>`, `<user@…>`, GFM `www.…`) and `[https://…](https://…)` have their URL
//   as text. A URL names its target exactly, and no default phrase is a URL, so under the default
//   list it is never reported. A URL a project puts in its own phrase list is matched like any
//   other phrase: the rule has no URL branch to special-case it away.
// - An image inside a link contributes nothing to the text: the parser collects text from `value`
//   fields and an image carries `alt` instead, so `[![here](b.png)](a.md)` has no text and is
//   skipped, while `[![i](i.png) here](a.md)` has the text ` here` and is reported. Judging alt text
//   would need a separate parse field, because widening `text` would change the label every graph
//   edge explains itself with; alt text describes an image, which is a different check.
// - Inline code counts as text, so `` [`here`](a.md) `` is reported.
// - A reference link whose definition is missing never reaches `links`; the dangling reference is
//   a reference-integrity finding, not a link-text one.
// - Empty text, or text that is only punctuation (`[→](a.md)`), normalises to "" and no phrase can
//   match it.
//
// The whole normalised text must equal a phrase, so `[more about installation](a.md)` is fine even
// though `more` is listed. One pass over `links` in document order with all state local to the
// call, so the findings' order is fixed by the document alone.
export function linkTextFindings(
  document: ParsedDocument,
  options: LinkTextOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const link of document.links) {
    const visible = link.visibleText ?? link.text;
    if (visible === undefined) {
      continue;
    }
    const text = displayLinkText(visible);
    const phrase = text.toLowerCase();
    if (phrase.length === 0 || !options.phrases.has(phrase)) {
      continue;
    }
    findings.push({
      message: `Link text "${text}" does not describe its target; name what the link leads to.`,
      line: link.line,
      ...(link.column === undefined ? {} : { column: link.column }),
      data: { text, phrase, target: link.rawTarget },
    });
  }

  return findings;
}
