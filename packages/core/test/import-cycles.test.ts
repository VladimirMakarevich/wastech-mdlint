import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// No product module imports, through any chain, a module that imports it back. In an ES module
// cycle, whichever module the loader reaches first runs against the other's bindings before they
// are initialized, so a `const` or class read at load time is a TDZ error that depends on which
// entrypoint was loaded first — a host can start where a test never does. A cycle also says that
// two modules are one concern split in two.
//
// Only imports that survive compilation count: `import type` and `export type` are erased, so a
// type-only reference back is no cycle at runtime. Relative specifiers are the only ones that can
// close a cycle within a package; between packages the dependency direction is fixed by package.json.

const packagesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

// `import … from "./x.js"` and `export … from "./x.js"`, spanning lines, unless the whole statement
// is `import type` / `export type`. An inline `import { type A, b }` still loads the module.
const RELATIVE_IMPORT =
  /^(?:import|export)\s+(type\s+)?(?:[^;]*?\sfrom\s+)?"(\.{1,2}\/[^"]+)"/gms;

function runtimeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(RELATIVE_IMPORT)].flatMap((match) =>
    match[1] === undefined
      ? [path.resolve(path.dirname(file), match[2]!.replace(/\.js$/, ".ts"))]
      : [],
  );
}

// Tarjan's strongly connected components: every group of two or more modules that reach each other.
function cycles(graph: Map<string, string[]>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const connect = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) {
        continue;
      }
      if (!index.has(next)) {
        connect(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) {
        found.push(component);
      }
    }
  };
  for (const node of graph.keys()) {
    if (!index.has(node)) {
      connect(node);
    }
  }
  return found;
}

describe("runtime import graph", () => {
  const files = readdirSync(packagesDir).flatMap((name) => {
    const src = path.join(packagesDir, name, "src");
    try {
      return sourceFiles(src);
    } catch {
      return [];
    }
  });
  const graph = new Map(files.map((file) => [file, runtimeImports(file)]));

  // Pins the parse itself: a pattern that matched nothing would make the assertion below vacuous.
  it("reads the relative imports of every package's sources", () => {
    expect(files.length).toBeGreaterThan(100);
    const edges = [...graph.values()].flat();
    expect(edges.length).toBeGreaterThan(files.length);
    expect(edges.filter((target) => graph.has(target)).length).toBe(
      edges.length,
    );
  });

  it("has no cycle between product modules", () => {
    const named = cycles(graph).map((component) =>
      component
        .map((file) => path.relative(packagesDir, file).replaceAll("\\", "/"))
        .sort(),
    );
    expect(named).toEqual([]);
  });

  it("finds a cycle when there is one", () => {
    expect(
      cycles(
        new Map([
          ["a", ["b"]],
          ["b", ["c"]],
          ["c", ["a"]],
          ["d", ["a"]],
        ]),
      ).map((component) => component.sort()),
    ).toEqual([["a", "b", "c"]]);
  });
});
