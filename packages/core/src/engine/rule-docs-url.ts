// The one place a rule's documentation URL is constructed (P15.03 / W-35 + W-36). Two consumers
// need it — `helpUri` on every finding and the README rule table's link — and shipping two fields
// or two spellings that both mean "a rule's documentation page" is exactly the drift this task
// closes, so both read this constant.
//
// This is a leaf module on purpose: `registry.ts` needs it, and `rule-docs.ts` (the other natural
// home) imports `rules/index.js`, which imports `registry.ts`. Putting the helper there would make
// registry → rule-docs → rules/index → registry a cycle.
//
// `blob/main` rather than a version tag: nothing at runtime knows which version is installed, and
// the guide pages ship in no tarball, so a pinned install links to the current docs rather than to
// its own. Recorded in `docs/mdlint_v2/accepted-behaviors.md`.
export const RULE_DOCS_BASE_URL =
  "https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/rules/";

// Every built-in rule id has a page named after it under that directory; pinned by
// `registry-inventory.test.ts`, which resolves each URL back to a file on disk.
export function ruleDocsUrl(ruleId: string): string {
  return `${RULE_DOCS_BASE_URL}${ruleId}.md`;
}

// A user-authored custom id has no page of its own, so its findings point at the page documenting
// the mechanism instead of at a URL that would 404.
export const CUSTOM_RULE_DOCS_URL = ruleDocsUrl("custom");
