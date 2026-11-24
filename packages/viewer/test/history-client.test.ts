import { describe, expect, it } from "vitest";

import { readHistory } from "../src/client/history.js";

const commit = { short: "1a2b3c4", date: "2026-11-01", subject: "edit" };

describe("readHistory", () => {
  it("lists the commits the server sent", () => {
    expect(readHistory(true, { commits: [commit] })).toEqual({
      commits: [commit],
    });
  });

  it("says no commit touched the document only when the server said so", () => {
    expect(readHistory(true, { commits: [] })).toEqual({
      note: "No commit touches this document yet.",
      answered: true,
    });
  });

  // The defect this guards: a refusal carries `{ error }` and no `commits`, and read as an empty
  // history it told the reader no commit had touched a document git simply could not be asked about.
  it("shows a refusal's reason and asks again next time", () => {
    expect(
      readHistory(false, { error: "This document is not in the corpus." }),
    ).toEqual({ note: "This document is not in the corpus.", answered: false });
    expect(readHistory(true, {})).toEqual({
      note: "The history could not be loaded.",
      answered: false,
    });
  });
});
