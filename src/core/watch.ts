import path from "node:path";

import type { BrunogenConfig } from "./model";

export const defaultWatchInclude = [
  "**/*.php",
  "**/*.go",
  "**/*.js",
  "**/*.cjs",
  "**/*.mjs",
  "**/*.ts",
];

export const defaultWatchExclude = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/.git/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.brunogen/**",
];

export function resolveWatchGlobs(input: {
  projectRoot: string;
  config: BrunogenConfig;
  configPath?: string | null;
  openApiPath: string;
  brunoDir: string;
  aiDir?: string;
  mcpDir?: string;
}): { watchPaths: string[]; ignored: string[] } {
  const { projectRoot, config, configPath, openApiPath, brunoDir, aiDir, mcpDir } = input;
  const watchPaths = config.watch.include.map((pattern) =>
    path.join(projectRoot, pattern),
  );

  if (configPath) {
    watchPaths.push(configPath);
  }

  const ignored = [
    ...config.watch.exclude.map((pattern) => path.join(projectRoot, pattern)),
    openApiPath,
    path.join(brunoDir, "**"),
    ...(aiDir ? [path.join(aiDir, "**")] : []),
    ...(mcpDir ? [path.join(mcpDir, "**")] : []),
  ];

  return { watchPaths, ignored };
}
