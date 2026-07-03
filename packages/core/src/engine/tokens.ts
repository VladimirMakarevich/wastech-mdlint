// Token estimation, isolated behind one function (D3 / roadmap §8) so the heuristic can be swapped
// for a real tokenizer later without touching rules. Matches the legacy `ceil(len/4)` behavior so
// SIZE-001/LLM-001 numbers are stable across the re-platform.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
