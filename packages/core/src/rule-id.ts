// Canonical rule-ID normalization (C3).
//
// v2 kills the `ref001` (config) vs `REF-001` (output) split: input is accepted case-insensitively
// and dash-optionally, and always emitted canonical. One helper is shared by inline-disable
// directive extraction (P1.04), config rule resolution (P2.04), and the schema sync test (P2.06)
// so every surface normalizes identically.

// Built-in IDs are `PREFIX-DIGITS` (REF-001, TBL-006, SIZE-001, LLM-001). The prefix run is lazy
// so the split lands before the trailing digit run even when the dash is omitted (`REF001`).
const BUILTIN_SHAPE = /^([A-Z][A-Z0-9]*?)-?([0-9]+)$/;

/**
 * Normalize a rule ID to its canonical form.
 *
 * - `ref-001`, `REF001`, `Ref-001` → `REF-001` (case-insensitive, dash-optional for the
 *   built-in `PREFIX-DIGITS` shape).
 * - Custom IDs that are not the built-in shape (e.g. `req-owner`) are upper-cased with their
 *   existing dashes preserved (`REQ-OWNER`) — a dash cannot be inferred between two letter runs.
 */
export function canonicalizeRuleId(raw: string): string {
  const upper = raw.trim().toUpperCase();
  const match = BUILTIN_SHAPE.exec(upper);

  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  return upper;
}
