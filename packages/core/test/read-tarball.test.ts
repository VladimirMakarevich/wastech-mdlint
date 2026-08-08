import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { readTarball } from "./support/read-tarball.js";

// `read-tarball.ts` is hand-rolled binary parsing, and `package-payload.test.ts` — the only thing
// that exercises it — cannot tell a reader bug from a packaging defect: every entry the walk drops
// surfaces there as `"<pkg> ships no <entry>"`. Its dangerous failure is therefore a *partial* map,
// not an empty one, and that suite's positive control (`payload().size > 0`) only sees the empty
// case. So the cases below are the ones that would truncate the walk mid-archive: a misread header
// length, a skipped entry type, an unpadded body. Each puts an ordinary file *after* the awkward
// entry, because reading that last file is what proves the walk stayed aligned.
//
// The archives are assembled here by hand rather than produced by `npm pack`, so a case can be
// constructed that a real pack would not currently emit (a split long path, a pax header) and so a
// failure names one field rather than a whole tarball.

const BLOCK_SIZE = 512;

// ustar header field offsets, matching the reader's own named slices.
const NAME_OFFSET = 0;
const SIZE_OFFSET = 124;
const TYPE_FLAG_OFFSET = 156;
const PREFIX_OFFSET = 345;

interface HeaderFields {
  readonly name: string;
  readonly prefix?: string;
  /** Written verbatim into the size field, so a case can put something unparseable there. */
  readonly sizeField?: string;
  /** `"0"` regular file, `"5"` directory, `"x"` pax extended header. */
  readonly typeFlag?: string;
}

/**
 * One 512-byte header block.
 *
 * The checksum field is left zeroed: the reader does not verify it, and writing a correct one would
 * assert something about this helper instead of about the code under test.
 */
function header(fields: HeaderFields, size: number): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE);
  block.write(fields.name, NAME_OFFSET, "utf8");
  block.write(
    fields.sizeField ?? size.toString(8).padStart(11, "0"),
    SIZE_OFFSET,
    "utf8",
  );
  block.write(fields.typeFlag ?? "0", TYPE_FLAG_OFFSET, "utf8");
  block.write(fields.prefix ?? "", PREFIX_OFFSET, "utf8");
  return block;
}

/** A header plus its body, padded up to a whole number of blocks the way tar writes it. */
function entry(fields: HeaderFields, body = ""): Buffer {
  const content = Buffer.from(body, "utf8");
  const padded = Buffer.alloc(
    Math.ceil(content.length / BLOCK_SIZE) * BLOCK_SIZE,
  );
  content.copy(padded);
  return Buffer.concat([header(fields, content.length), padded]);
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Gzip the assembled blocks with tar's two-block terminator and hand back a path to read. */
function tarball(...parts: Buffer[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wastech-mdlint-tar-"));
  tempDirs.push(dir);
  const file = path.join(dir, "archive.tgz");
  writeFileSync(
    file,
    gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK_SIZE * 2)])),
  );
  return file;
}

describe("readTarball", () => {
  it("keeps reading past a directory entry, a pax header and an unpadded body", () => {
    // One archive rather than four, so the assertion is that the walk arrives at the *last* entry —
    // which is the property each of these entry shapes could break, and which four separate
    // single-entry archives would never test.
    const tgz = tarball(
      // A body that is not a block multiple: 5 bytes occupy a whole 512-byte block, and a reader
      // that advanced by the byte count would land mid-header for everything after it.
      entry({ name: "package/README.md" }, "# Hi\n"),
      entry({ name: "package/dist/", typeFlag: "5" }),
      // A pax header carries metadata for the entry that follows, and has a body of its own to
      // step over.
      entry(
        { name: "package/PaxHeader/dist/index.js", typeFlag: "x" },
        "30 path=x\n",
      ),
      entry({ name: "package/dist/index.js" }, "export {};\n"),
    );

    const entries = readTarball(tgz);

    // The `package/` prefix npm always prepends is stripped, and the directory and pax entries hold
    // no package content, so neither becomes a key.
    expect([...entries.keys()].sort()).toEqual(["README.md", "dist/index.js"]);
    expect(entries.get("README.md")!.toString("utf8")).toBe("# Hi\n");
    expect(entries.get("dist/index.js")!.toString("utf8")).toBe("export {};\n");
  });

  it("joins a path split across the prefix and name fields", () => {
    // The `name` field is 100 bytes; anything longer is split, and a reader that ignored `prefix`
    // would key the entry by its tail alone — present in the map, unfindable by its real path.
    const tgz = tarball(
      entry(
        { prefix: "package/deeply/nested/directory", name: "file.md" },
        "# Deep\n",
      ),
    );

    const entries = readTarball(tgz);

    expect([...entries.keys()]).toEqual(["deeply/nested/directory/file.md"]);
  });

  it("throws on an unreadable size field rather than returning what it read so far", () => {
    // The whole reason the reader checks: a `NaN` next offset ends the walk quietly, and the
    // truncated map that comes back reads downstream as a packaging defect in every entry it lost.
    const tgz = tarball(
      entry({ name: "package/README.md" }, "# Hi\n"),
      entry({ name: "package/dist/index.js", sizeField: "not-octal" }),
      entry({ name: "package/package.json" }, "{}\n"),
    );

    expect(() => readTarball(tgz)).toThrow(/size field is not octal/);
  });
});
