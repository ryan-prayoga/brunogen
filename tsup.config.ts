import { defineConfig } from "tsup";

const packageJson = require("./package.json") as {
  dependencies?: Record<string, string>;
};

export const runtimeExternalPackages = Object.keys(packageJson.dependencies ?? {});

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["cjs"],
  dts: true,
  clean: true,
  target: "es2022",
  external: runtimeExternalPackages,
});
