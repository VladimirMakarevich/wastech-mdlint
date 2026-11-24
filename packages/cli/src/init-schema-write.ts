import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AtomicFileWrite,
  GeneratedInitConfig,
  ProjectSchemaReason,
} from "@wastech-mdlint/core";

import { fileExists } from "./init-opt-in.js";
import type { ExistingConfigAction } from "./init-types.js";

// Whether the project-local `schema.json` a config points at may be written, decided before any file
// is touched so the config and schema can be committed as one atomic batch.

/**
 * Outcome of the project-local `schema.json` write, decided by `resolveSchemaWriteOutcome` before
 * any filesystem write happens. `path` is a repository-relative POSIX path; `reason` is carried
 * straight through from `generateInitConfig` so the summary never guesses why the file exists.
 */
export type SchemaWriteOutcome = {
  kind: "written" | "unchanged" | "kept" | "overwritten" | "unreadable";
  path: string;
  reason: ProjectSchemaReason;
};

/**
 * Guards the project-local `schema.json` write with the same `--on-existing` signal that already
 * governs the config write. This write once had no guard at all, unlike the sibling CI-workflow
 * write. Byte-compares an existing file against the freshly generated text first:
 * identical bytes mean there is nothing to preserve, so a repeat `init` run reports "unchanged"
 * (no write) instead of the "kept" warning — that warning is reserved for a real divergence worth
 * flagging. Only once the bytes actually differ does `"overwrite"` bypass the guard; `"merge"` and
 * `"none"` both leave a differing file untouched. Pure so the decision itself — not just its
 * string rendering — is directly testable.
 *
 * `existingSchemaUnreadable` takes precedence over every other check and is a required field:
 * the read that produces `existingSchemaText` degrades *any* failure to `undefined`, which used to be
 * harmless because the write would then fail identically. Atomic writes changed that — `rename` needs
 * write permission on the *directory*, not on the target — so without this signal a present-but-
 * unreadable `schema.json` would be silently replaced, exactly the implicit file-clobbering the
 * guard exists to prevent.
 *
 * `reason` narrows the one destructive outcome. `--on-existing overwrite` is a disposition for the
 * *config* — the user never named `schema.json` — so it may only reach a pre-existing schema whose
 * contents this config actually determines, i.e. `"custom-rules"`. Under `"no-installed-package"`
 * the file is generated purely as a resolvable target for `$schema`, and `schema.json` is a common
 * name for something else entirely (an OpenAPI document, a product schema), so a differing file
 * there degrades to `"kept"`: nothing the user asked for depends on replacing it.
 */
export function resolveSchemaWriteOutcome(params: {
  existingConfigAction: ExistingConfigAction | "none";
  existingSchemaText: string | undefined;
  existingSchemaUnreadable: boolean;
  generatedSchemaText: string;
  reason: ProjectSchemaReason;
}): { shouldWrite: boolean; kind: SchemaWriteOutcome["kind"] } {
  const {
    existingConfigAction,
    existingSchemaText,
    existingSchemaUnreadable,
    generatedSchemaText,
    reason,
  } = params;
  if (existingSchemaUnreadable) {
    return { shouldWrite: false, kind: "unreadable" };
  }
  if (existingSchemaText === undefined) {
    return { shouldWrite: true, kind: "written" };
  }
  if (existingSchemaText === generatedSchemaText) {
    return { shouldWrite: false, kind: "unchanged" };
  }
  if (existingConfigAction === "overwrite" && reason === "custom-rules") {
    return { shouldWrite: true, kind: "overwritten" };
  }
  return { shouldWrite: false, kind: "kept" };
}

/**
 * Reads whatever `schema.json` already sits beside the config, decides through
 * `resolveSchemaWriteOutcome` whether to replace it, and returns the write to stage (if any) with the
 * outcome the summary reports. `toRepoRelative` is the caller's, so the reported path shares the
 * anchor every other path in the summary uses.
 */
export async function planProjectSchemaWrite(params: {
  cwd: string;
  projectSchema: NonNullable<GeneratedInitConfig["projectSchema"]>;
  existingConfigAction: ExistingConfigAction | "none";
  toRepoRelative: (absolutePath: string) => string;
}): Promise<{
  write: AtomicFileWrite | undefined;
  outcome: SchemaWriteOutcome;
}> {
  const { projectSchema, existingConfigAction } = params;
  const schemaPath = path.join(params.cwd, projectSchema.fileName);
  const schemaRelativePath = params.toRepoRelative(schemaPath);
  // A full read (not just fileExists) so an identical repeat run can report "unchanged" rather
  // than the "kept" warning — any read failure (missing file, permission error) degrades to
  // undefined, the same "treat it as absent" behavior fileExists has.
  const existingSchemaText = await readFile(schemaPath, "utf8").catch(
    () => undefined,
  );
  const decision = resolveSchemaWriteOutcome({
    existingConfigAction,
    existingSchemaText,
    // Separates "absent" from "present but unreadable", which the read above collapses into one
    // `undefined`. Under the old truncate-and-write that conflation was harmless (an unreadable
    // file usually failed the write too); a temp+rename commit only needs write permission on the
    // directory, so without this the guard would happily replace a file it could not even read.
    existingSchemaUnreadable:
      existingSchemaText === undefined && (await fileExists(schemaPath)),
    generatedSchemaText: projectSchema.text,
    // Gates the one destructive outcome: only a schema whose *contents* this config determines
    // (custom rules) may be replaced under `--on-existing overwrite`. The `npx` fallback merely
    // needs some resolvable target, so it must never clobber a `schema.json` that was already
    // there for unrelated reasons.
    reason: projectSchema.reason,
  });
  return {
    write: decision.shouldWrite
      ? { path: schemaPath, content: projectSchema.text }
      : undefined,
    outcome: {
      kind: decision.kind,
      path: schemaRelativePath,
      reason: projectSchema.reason,
    },
  };
}
