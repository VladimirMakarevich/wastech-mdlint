import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";

// The phase plan answers "is this done?" twice — once on a phase index and once in each task file
// beneath it — and for most of this project's life the two answers disagreed in both directions.
// Four indexes read `Not started` above task files that were all finished, while ninety-odd boxes in
// four completed phases read as open work. Neither side was wrong by accident: nothing compared
// them, so a formatting pass could rewrite an index's every line and preserve a stale status
// verbatim, which is exactly what one merge did.
//
// So this file compares them. It cannot tell whether a criterion is *true* — only an author can —
// but it can tell whether the plan contradicts itself, which is the property that was missing and
// the one that decays silently.
//
// Deliberately not tagged as one of the suite's process-boundary guards. Those categories are a
// paired set whose membership is a decision about the guard vocabulary itself, and this subject —
// planning-document consistency — is not one of them.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const planRoot = path.join(repoRoot, "docs", "mdlint_v2");

// A phase index carries one of exactly three values, and the third exists because the vocabulary
// used to have only two: neither `Not started` nor `Done` honestly describes "four of six tasks have
// landed", which is how `Not started` came to sit above finished work.
const NOT_STARTED = "Not started";
const IN_PROGRESS = "In progress";
const DONE = "Done";

// A task file may also be disposed of without being done — a stretch item whose gate never lifted,
// closed with a dated note. That counts toward its phase being finished, because the disposition is
// the outcome; it is spelled as a `Deferred …` status rather than a bare `Deferred` so the line
// carries the date a reader needs.
const DEFERRED_PREFIX = "Deferred";

// Line-anchored so an inline `[ ]` written inside prose or a code span is not mistaken for a
// tracking box. Only a list item at the start of a line is one.
const OPEN_CHECKBOX = /^[ \t]*- \[ \] /m;
// Anchored to the header blockquote every plan file opens with, not to the first `Status **…**`
// anywhere in the text. Plan files quote each other's statuses in prose — one of them quotes
// `Status **Done**` while its own header reads `Not started` — so an unanchored match lets a file
// that loses its header status silently inherit a prose one, which is precisely the "declares a
// status" assertion below going vacuously green and a derived index status flipping unnoticed.
const STATUS = /^> .*Status \*\*([^*]+)\*\*/m;

interface PlanFile {
  /** Repository-relative POSIX path, so a failure message reads the same on every host. */
  readonly id: string;
  readonly status: string | undefined;
  readonly hasOpenCheckbox: boolean;
}

function readPlanFile(phaseDir: string, fileName: string): PlanFile {
  const contents = readFileSync(
    path.join(planRoot, phaseDir, fileName),
    "utf8",
  );
  return {
    id: `docs/mdlint_v2/${phaseDir}/${fileName}`,
    status: STATUS.exec(contents)?.[1],
    hasOpenCheckbox: OPEN_CHECKBOX.test(contents),
  };
}

function isDisposed(status: string | undefined): boolean {
  return status === DONE || (status?.startsWith(DEFERRED_PREFIX) ?? false);
}

/**
 * A phase index's status is derived from the task files beneath it rather than asserted on its own.
 * That is the whole correction: the index was the level nothing owned, so making it a function of
 * the level authors actually stand in removes the place drift could hide.
 */
function deriveIndexStatus(
  taskStatuses: readonly (string | undefined)[],
): string {
  const disposed = taskStatuses.filter(isDisposed).length;
  if (disposed === taskStatuses.length) {
    return DONE;
  }
  return disposed === 0 ? NOT_STARTED : IN_PROGRESS;
}

const phases = readdirSync(planRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("P"))
  .map((entry) => entry.name)
  .sort(compareStrings);

const plan = phases.map((phaseDir) => {
  const fileNames = readdirSync(path.join(planRoot, phaseDir))
    .filter((name) => name.endsWith(".md"))
    .sort(compareStrings);
  return {
    phaseDir,
    index: readPlanFile(phaseDir, "index.md"),
    tasks: fileNames
      .filter((name) => name !== "index.md")
      .map((name) => readPlanFile(phaseDir, name)),
  };
});

const everyFile = plan.flatMap(({ index, tasks }) => [index, ...tasks]);

describe("plan completion surface", () => {
  it("finds a plan tree big enough for the assertions below to mean anything", () => {
    // Without this, a renamed directory or a changed layout would empty every list above and turn
    // the rest of this file into three green vacuous assertions — the same "green because it
    // analyzed nothing" failure a narrowed lint scope produces.
    expect(phases.length).toBeGreaterThanOrEqual(15);
    expect(everyFile.length).toBeGreaterThanOrEqual(100);
    expect(plan.filter(({ tasks }) => tasks.length === 0)).toEqual([]);
  });

  it("declares a status on every index and task file", () => {
    // A file with no status line is invisible to the derivation below: it silently reads as
    // not-disposed and drags its phase back to `In progress` forever. One such file did exist,
    // written by a different authoring path, and it also went unlisted in its own index — the two
    // symptoms travel together.
    expect(everyFile.filter((file) => file.status === undefined)).toEqual([]);
  });

  it("gives each index the status its task files add up to", () => {
    // Compared as one object rather than per phase so a failure names every drifted index at once,
    // instead of stopping at the first and hiding the rest behind a rerun.
    const declared = Object.fromEntries(
      plan.map(({ index }) => [index.id, index.status]),
    );
    const derived = Object.fromEntries(
      plan.map(({ index, tasks }) => [
        index.id,
        deriveIndexStatus(tasks.map((task) => task.status)),
      ]),
    );

    expect(declared).toEqual(derived);
  });

  it("leaves no open checkbox in a file that claims to be done", () => {
    // An open box in a `Done` file is a promise nobody owes: either the work landed and the box was
    // never ticked, or the check can never be run and the line should have been retired in place
    // with its reason. Both read to a contributor as outstanding work in a finished phase.
    //
    // A `Deferred …` file is deliberately exempt — its open boxes describe the work that would close
    // it if the gate it waits on ever lifts, which is honest rather than stale.
    const offenders = everyFile
      .filter((file) => file.status === DONE && file.hasOpenCheckbox)
      .map((file) => file.id);

    expect(offenders).toEqual([]);
  });
});

describe("phase status derivation", () => {
  // Exercised on synthetic inputs as well as the real tree so the rule stays pinned even when no
  // phase in the tree happens to be in a given state — today nothing is `Not started` except the
  // release phase, and one phase landing would take the only `In progress` case with it.
  it("maps a task-status set to exactly one index status", () => {
    expect({
      empty: deriveIndexStatus([]),
      none: deriveIndexStatus([NOT_STARTED, NOT_STARTED]),
      some: deriveIndexStatus([DONE, NOT_STARTED]),
      all: deriveIndexStatus([DONE, DONE]),
      deferredCounts: deriveIndexStatus([
        DONE,
        "Deferred to backlog (2026-07-25)",
      ]),
      deferredAlone: deriveIndexStatus([
        "Deferred to backlog (2026-07-25)",
        NOT_STARTED,
      ]),
    }).toEqual({
      // No task files at all cannot be distinguished from all of them being disposed of, so the
      // vacuous case is pinned here and ruled out separately by the tree-size assertion above.
      empty: DONE,
      none: NOT_STARTED,
      some: IN_PROGRESS,
      all: DONE,
      deferredCounts: DONE,
      deferredAlone: IN_PROGRESS,
    });
  });
});
