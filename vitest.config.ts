import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Resolves each workspace package's own Vitest config (packages/core, packages/cli, ...).
    // Nothing runs at the root anymore: P0.05 relocated the last root suite (cli.ts + its
    // fixtures) into packages/cli.
    projects: ["packages/*"]
  }
});
