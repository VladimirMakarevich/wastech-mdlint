import type { LintMessage } from "../engine/types.js";

// Two lint runs compared: the findings the second adds and the ones it no longer reports. Every
// host that shows such a difference - a config edit previewed before it is saved, a branch reviewed
// against its base - goes through this one comparison, so two of them can never disagree about what
// counts as the same finding.

/**
 * Where a finding of the earlier run would sit in the later run's text - its file and line there -
 * or `undefined` when the line it was on is gone. Two runs over the same text need none; across a
 * branch, a paragraph inserted above a finding moves it down without changing it.
 */
export type FindingLocator = (
  message: LintMessage,
) => { filePath: string; line: number } | undefined;

export type FindingsDelta = {
  /** Findings of the later run, in its order, beyond as many equal ones as the earlier run had. */
  added: LintMessage[];
  /** Findings of the earlier run, in its order, as it reported them, that the later run lacks. */
  removed: LintMessage[];
};

/**
 * Compare two runs' findings as multisets. Findings are the same when file, rule, line, severity and
 * message all match, so one that changed any of them - a budget message whose number moved, a
 * warning made an error - is gone in its old form and new in its new one, which is what a reader
 * needs to see. With `locate`, the earlier run's findings are moved to the later run's file and line
 * first, and one that cannot be moved is removed.
 */
export function compareFindings(
  before: readonly LintMessage[],
  after: readonly LintMessage[],
  locate?: FindingLocator,
): FindingsDelta {
  const beforeKeys = before.map((message) => {
    const place =
      locate === undefined
        ? { filePath: message.filePath, line: message.line }
        : locate(message);
    return place === undefined ? undefined : findingKey(message, place);
  });
  const afterKeys = after.map((message) => findingKey(message, message));
  return {
    added: beyond(after, afterKeys, countKeys(beforeKeys)),
    removed: beyond(before, beforeKeys, countKeys(afterKeys)),
  };
}

function findingKey(
  message: LintMessage,
  place: { filePath: string; line: number },
): string {
  // NUL-joined: paths and messages hold spaces, so a space-joined key could fuse two findings.
  return [
    place.filePath,
    message.ruleId,
    place.line,
    message.severity,
    message.message,
  ].join("\u0000");
}

function countKeys(keys: readonly (string | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (key !== undefined) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// The messages beyond as many of each key as `other` holds. A message without a key matches nothing.
function beyond(
  messages: readonly LintMessage[],
  keys: readonly (string | undefined)[],
  other: ReadonlyMap<string, number>,
): LintMessage[] {
  const remaining = new Map(other);
  const result: LintMessage[] = [];
  messages.forEach((message, index) => {
    const key = keys[index];
    const left = key === undefined ? 0 : (remaining.get(key) ?? 0);
    if (key !== undefined && left > 0) {
      remaining.set(key, left - 1);
    } else {
      result.push(message);
    }
  });
  return result;
}
