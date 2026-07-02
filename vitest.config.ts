import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // src/cli.ts stays at the root until P0.05 relocates it into @wastech-mdlint/cli, so its
      // tests (and the fixtures-based e2e suite) stay here too.
      { test: { name: "root", include: ["test/**/*.test.ts"] } },
      // Resolves each workspace package's Vitest config, e.g. packages/core's moved unit suite.
      "packages/*"
    ]
  }
});
