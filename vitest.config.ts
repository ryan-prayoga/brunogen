import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 68,
        functions: 88,
        lines: 80,
      },
    },
  },
});
