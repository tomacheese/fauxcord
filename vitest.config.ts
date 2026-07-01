import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test environment settings
    environment: "node",
    // Do not use globals (require explicit imports)
    globals: false,
    // Coverage settings
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
    // Test file pattern
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
