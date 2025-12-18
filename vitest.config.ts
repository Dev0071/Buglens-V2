import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Run test files sequentially to prevent database contamination
    fileParallelism: false,
    // Tests within a file run sequentially
    sequence: {
      concurrent: false,
    },
    // Increase timeout for integration tests
    testTimeout: 30000,
    hookTimeout: 30000,
    // Exclude web frontend tests - they have their own vitest config
    exclude: ["node_modules/**", "web/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/**", "dist/**", "**/*.test.ts", "**/*.config.ts"],
    },
  },
});
