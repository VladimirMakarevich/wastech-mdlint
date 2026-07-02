import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    // No tests exist yet in P0.03; the suite is populated in P0.04 when real modules move in.
    include: ["test/**/*.test.ts"]
  }
});
