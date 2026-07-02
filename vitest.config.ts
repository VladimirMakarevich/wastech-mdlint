import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Interim root project covering the current single-package suite; dropped in P0.04.
      { test: { name: "root", include: ["test/**/*.test.ts"] } },
      // Resolves each workspace package's Vitest config; matches nothing until P0.03.
      "packages/*"
    ]
  }
});
