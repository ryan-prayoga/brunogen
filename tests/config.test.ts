import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { defaultConfig, loadConfig, resolveFromConfigRoot } from "../src/core/config";
import { resolveWatchGlobs } from "../src/core/watch";

describe("Config loading", () => {
  it("formats invalid JSON config errors without leaking parser stacks", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "brunogen-config-"));
    try {
      await fs.writeFile(
        path.join(workspace, "brunogen.config.json"),
        "{ invalid json\n",
        "utf8",
      );

      await expect(loadConfig(workspace)).rejects.toThrow(
        /Invalid brunogen config at .*Expected property name/,
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("formats schema validation errors with field paths", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "brunogen-config-"));
    try {
      await fs.writeFile(
        path.join(workspace, "brunogen.config.json"),
        JSON.stringify({ version: 2 }),
        "utf8",
      );

      await expect(loadConfig(workspace)).rejects.toThrow(
        /Invalid brunogen config at .*\n- version: Invalid input: expected 1/,
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("resolves default and custom watch globs from the project root", () => {
    const config = defaultConfig();
    config.watch.include = ["app/**/*.php"];
    config.watch.exclude = ["**/vendor/**", "storage/**"];

    const projectRoot = "/repo/app";
    const configPath = "/repo/config/brunogen.config.json";
    const openApiPath = resolveFromConfigRoot(configPath, "../out/openapi.yaml", process.cwd());
    const brunoDir = resolveFromConfigRoot(configPath, "../out/bruno", process.cwd());
    const { watchPaths, ignored } = resolveWatchGlobs({
      projectRoot,
      config,
      configPath,
      openApiPath,
      brunoDir,
    });

    expect(watchPaths).toEqual([
      path.join(projectRoot, "app/**/*.php"),
      configPath,
    ]);
    expect(ignored).toEqual([
      path.join(projectRoot, "**/vendor/**"),
      path.join(projectRoot, "storage/**"),
      openApiPath,
      path.join(brunoDir, "**"),
    ]);
  });
});
