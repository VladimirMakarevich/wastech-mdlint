import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Resolves each workspace package's own Vitest config (packages/core, packages/cli, ...).
    // Nothing runs at the root: the last root-level suite and its fixtures were relocated into
    // packages/cli, so a suite added at the root would silently never run.
    projects: ["packages/*"],
  },
});
