import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// A dependency-free reader for the `.tgz` that `npm pack` produces, so `package-payload.test.ts`
// can assert on what a stranger actually downloads rather than on what a manifest promises.
//
// Written by hand instead of adding the `tar` package because the payload guard exists to stop a
// packaging regression, and paying for it with a new dev dependency in the very tree it guards is
// the wrong trade. The format read here is the fixed-width ustar header `node-tar` writes — 512-byte
// blocks, octal fields, no extensions — which is small enough to parse correctly in one pass and
// does not change.
//
// Lives in core's test support directory for the same reason `assert-built.ts` and
// `large-corpus.ts` do: it imports nothing from any package's `src`, so any package's suite can use
// it without pulling core's internals into its module graph.

const BLOCK_SIZE = 512;

/** Field offsets inside a ustar header block (POSIX.1-1988), named so the slices below read. */
const NAME = { start: 0, end: 100 } as const;
const SIZE = { start: 124, end: 136 } as const;
const TYPE_FLAG = 156;
const PREFIX = { start: 345, end: 500 } as const;

/** Header fields are NUL-padded; everything from the first NUL on is padding, not content. */
function readField(header: Buffer, start: number, end: number): string {
  const field = header.subarray(start, end);
  const terminator = field.indexOf(0);
  return field
    .subarray(0, terminator === -1 ? field.length : terminator)
    .toString("utf8")
    .trim();
}

/**
 * Read every regular file out of an `npm pack` tarball.
 *
 * Keys are the paths *inside the package* — `README.md`, `dist/index.js`, `package.json` — with the
 * `package/` prefix npm always prepends stripped off. Tar names are `/`-separated by specification,
 * so those keys satisfy the repository's POSIX-path invariant on Windows without any normalization.
 */
export function readTarball(tgzPath: string): Map<string, Buffer> {
  const tar = gunzipSync(readFileSync(tgzPath));
  const entries = new Map<string, Buffer>();

  let offset = 0;
  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    // The archive ends with zero-filled blocks; the first one is the terminator.
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readField(header, NAME.start, NAME.end);
    const prefix = readField(header, PREFIX.start, PREFIX.end);
    const size = Number.parseInt(readField(header, SIZE.start, SIZE.end), 8);
    const typeFlag = String.fromCharCode(header[TYPE_FLAG]!);

    // An unparseable size would make the next offset NaN, ending the walk quietly and returning a
    // truncated map — the one failure a payload guard cannot afford, because every "entry missing"
    // assertion would then be reporting the reader's bug as a packaging defect.
    if (!Number.isFinite(size)) {
      throw new Error(
        `Unreadable tar header at byte ${String(offset)} of ${tgzPath}: size field is not octal`,
      );
    }

    const bodyStart = offset + BLOCK_SIZE;
    // Body is padded up to a whole number of blocks.
    offset = bodyStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    // `0`/NUL are regular files. `5` is a directory (no body worth keeping) and `x`/`g` are pax
    // extended headers, which carry metadata for the entry that follows rather than package
    // content. Skipping the pax headers rather than parsing them is correct for this payload
    // specifically: `node-tar` emits one only for a path over 100 bytes or a non-ASCII name, and
    // the entry it describes still follows as an ordinary file block that this loop does read —
    // the only loss would be the long name, and this payload has none.
    if (typeFlag !== "0" && typeFlag !== "\0") {
      continue;
    }

    const packagePath = prefix === "" ? name : `${prefix}/${name}`;
    entries.set(
      packagePath.replace(/^package\//, ""),
      tar.subarray(bodyStart, bodyStart + size),
    );
  }

  return entries;
}
