import { describe, expect, it } from "vitest";

import { type DiffRun, diffSequences } from "../src/changes/sequence-diff.js";

// Rebuilds the head from the base and the script, and checks the runs cover both sequences exactly
// once and in order — the contract every consumer of a script relies on.
function apply<T>(
  base: readonly T[],
  head: readonly T[],
  runs: DiffRun[],
): T[] {
  const result: T[] = [];
  let baseAt = 0;
  let headAt = 0;
  for (const run of runs) {
    expect(run.length).toBeGreaterThan(0);
    expect(run.baseStart).toBe(baseAt);
    expect(run.headStart).toBe(headAt);
    if (run.kind === "equal") {
      for (let offset = 0; offset < run.length; offset += 1) {
        expect(base[baseAt + offset]).toBe(head[headAt + offset]);
        result.push(base[baseAt + offset] as T);
      }
      baseAt += run.length;
      headAt += run.length;
    } else if (run.kind === "delete") {
      baseAt += run.length;
    } else {
      result.push(...head.slice(headAt, headAt + run.length));
      headAt += run.length;
    }
  }
  expect(baseAt).toBe(base.length);
  expect(headAt).toBe(head.length);
  return result;
}

const editCount = (runs: DiffRun[]) =>
  runs
    .filter((run) => run.kind !== "equal")
    .reduce((sum, run) => sum + run.length, 0);

// The minimal number of edits, from a longest common subsequence: what Myers must reach.
function minimalEdits(
  base: readonly string[],
  head: readonly string[],
): number {
  const lengths = Array.from({ length: base.length + 1 }, () =>
    new Array<number>(head.length + 1).fill(0),
  );
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = head.length - 1; j >= 0; j -= 1) {
      (lengths[i] as number[])[j] =
        base[i] === head[j]
          ? ((lengths[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (lengths[i + 1] as number[])[j] as number,
              (lengths[i] as number[])[j + 1] as number,
            );
    }
  }
  return (
    base.length + head.length - 2 * ((lengths[0] as number[])[0] as number)
  );
}

// A fixed linear congruential generator, so the generated cases are the same on every run.
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("diffSequences", () => {
  it("covers empty and identical inputs", () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences(["a", "b"], ["a", "b"])).toEqual([
      { kind: "equal", baseStart: 0, headStart: 0, length: 2 },
    ]);
    expect(diffSequences([], ["a", "b"])).toEqual([
      { kind: "insert", baseStart: 0, headStart: 0, length: 2 },
    ]);
    expect(diffSequences(["a", "b"], [])).toEqual([
      { kind: "delete", baseStart: 0, headStart: 0, length: 2 },
    ]);
  });

  it("finds the shortest script on the textbook example", () => {
    const base = [..."abcabba"];
    const head = [..."cbabac"];
    const runs = diffSequences(base, head);
    expect(apply(base, head, runs)).toEqual(head);
    expect(editCount(runs)).toBe(5);
  });

  it("rebuilds the head with a minimal script on generated sequences", () => {
    const random = generator(42);
    for (let round = 0; round < 300; round += 1) {
      const alphabet = "abcd".slice(0, 1 + Math.floor(random() * 4));
      const make = () =>
        Array.from(
          { length: Math.floor(random() * 12) },
          () => alphabet[Math.floor(random() * alphabet.length)] as string,
        );
      const base = make();
      const head = make();
      const runs = diffSequences(base, head);
      expect(apply(base, head, runs)).toEqual(head);
      expect(editCount(runs)).toBe(minimalEdits(base, head));
    }
  });

  it("uses the given equality", () => {
    const runs = diffSequences(
      [" a ", "b"],
      ["a", "c"],
      (left, right) => left.trim() === right.trim(),
    );
    expect(runs).toEqual([
      { kind: "equal", baseStart: 0, headStart: 0, length: 1 },
      { kind: "delete", baseStart: 1, headStart: 1, length: 1 },
      { kind: "insert", baseStart: 2, headStart: 1, length: 1 },
    ]);
  });

  it("treats the middle as replaced past the edit limit, keeping the common start and end", () => {
    const base = [..."xabcdy"];
    const head = [..."xdcbay"];
    const runs = diffSequences(base, head, Object.is, 2);
    expect(runs).toEqual([
      { kind: "equal", baseStart: 0, headStart: 0, length: 1 },
      { kind: "delete", baseStart: 1, headStart: 1, length: 4 },
      { kind: "insert", baseStart: 5, headStart: 1, length: 4 },
      { kind: "equal", baseStart: 5, headStart: 5, length: 1 },
    ]);
    expect(apply(base, head, runs)).toEqual(head);
  });

  it("gives the same script for the same input", () => {
    const base = [..."the quick brown fox"];
    const head = [..."the quack brown box"];
    expect(diffSequences(base, head)).toEqual(diffSequences(base, head));
  });
});
