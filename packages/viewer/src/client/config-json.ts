import type { Edit, Json, JsonObject, Path } from "./config-types.js";

// The config editor's local copy of the config is plain JSON, changed by path. These helpers keep
// that copy in the shape the server's edits give the file, so the form shows what the text will say.

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function samePath(left: Path, right: Path): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

export function getAt(root: Json | null, path: Path): Json | undefined {
  let node: Json | undefined = root ?? undefined;
  for (const segment of path) {
    if (node === undefined || node === null || typeof node !== "object") {
      return undefined;
    }
    node = (node as Record<string | number, Json>)[segment];
  }
  return node;
}

// The same shape `editConfigText` gives the file: objects created on the way down for a missing
// name, so the form and the text agree on what an edit made.
export function setAt(root: JsonObject, path: Path, value: Json): JsonObject {
  let node: Json = root;
  path.forEach((segment, index) => {
    const container = node as Record<string | number, Json>;
    if (index === path.length - 1) {
      container[segment] = value;
      return;
    }
    const next = container[segment];
    if (next === undefined || next === null || typeof next !== "object") {
      container[segment] = typeof path[index + 1] === "number" ? [] : {};
    }
    node = container[segment]!;
  });
  return root;
}

export function removeAt(root: JsonObject, path: Path): void {
  const parent = getAt(root, path.slice(0, -1));
  const last = path.at(-1)!;
  if (Array.isArray(parent) && typeof last === "number") {
    parent.splice(last, 1);
  } else if (
    parent !== undefined &&
    parent !== null &&
    typeof parent === "object"
  ) {
    Reflect.deleteProperty(parent, String(last));
  }
}

export function insertAt(root: JsonObject, path: Path, value: Json): void {
  const parent = getAt(root, path.slice(0, -1));
  if (Array.isArray(parent)) {
    parent.splice(Number(path.at(-1)), 0, value);
  }
}

/**
 * Replays edits onto a model, in order, as the server applies them to the text. Stops once the model
 * is gone: an edit can only be replayed onto a config that loaded.
 */
export function replayEdits(
  model: JsonObject | null,
  edits: readonly Edit[],
): JsonObject | null {
  let current = model;
  for (const edit of edits) {
    if (current === null) {
      break;
    }
    if (edit.op === "set") {
      current = setAt(current, edit.path, clone(edit.value ?? null));
    } else if (edit.op === "remove") {
      removeAt(current, edit.path);
    } else {
      insertAt(current, edit.path, clone(edit.value ?? null));
    }
  }
  return current;
}

/**
 * A JSON value as a label or a field shows it: a string as itself, another scalar as its literal,
 * nothing as empty, and an array or object as its JSON — never the `[object Object]` that `String`
 * would give it.
 */
export function displayText(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}
