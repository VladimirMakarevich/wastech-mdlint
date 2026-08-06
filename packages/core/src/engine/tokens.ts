// Token estimation, isolated behind one function (D3 / roadmap §8) so the heuristic can be swapped
// for a real tokenizer later without touching rules. Matches the legacy `ceil(len/4)` behavior so
// SIZE-001/LLM-001 numbers are stable across the re-platform.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// The calibration, stated where a reader meets the number (P15.03 / W-34): every rule that reports a
// token count appends this to its message, because a budget whose arithmetic is undisclosed is a
// budget a user cannot set. It lives beside the heuristic on purpose — swapping `estimateTokens` for
// a real tokenizer has to move the sentence with the math, or the disclosure silently goes stale.
//
// "Runs low" is the direction that matters: `text.length` counts UTF-16 code units, and real
// tokenizers emit more tokens per character for non-Latin scripts, so a Cyrillic or CJK document
// consumes more context than this estimate claims — the wrong direction for a guardrail against
// context overflow. Measured on a real corpus, bytes per estimated token ranged 4.03 to 6.83.
export const TOKEN_ESTIMATE_NOTE =
  "Token counts are estimated as ceil(characters / 4) — UTF-16 code units, not bytes, and not a real tokenizer — so they run low for non-Latin scripts.";
