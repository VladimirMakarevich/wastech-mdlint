// Public barrel for @wastech-mdlint/core.
//
// Intentionally empty in P0.03: this task only stands up a buildable package shell so the
// CLI and MCP host packages have a resolvable dependency. The relocated pipeline modules
// (parser, config loading, rule engine, graph, compile) land in P0.04 and are re-exported
// from here. The empty `export {}` keeps this file an ES module so `tsc` emits
// dist/index.{js,d.ts} for the package `exports` map.
export {};
