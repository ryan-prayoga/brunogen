#!/usr/bin/env node

import path from "node:path";

import packageJson from "../package.json";

import {
  loadConfig,
  renderDefaultConfigFile,
  resolveFromConfigRoot,
} from "./core/config";
import { fileExists, writeTextFile } from "./core/fs";
import { runDoctor } from "./core/doctor";
import { resolveWatchGlobs } from "./core/watch";
import {
  collectOpenApiConsistencyWarnings,
  formatWarnings,
  generateArtifacts,
  resolveOutputFormats,
  validateOpenApi,
  writeArtifacts,
} from "./core/pipeline";
import type { ArtifactOutputPaths } from "./core/pipeline";
import { installBundledSkill } from "./core/skill";

void main().catch((error) => {
  console.error(formatErrorMessage(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { Command } = await import("commander");
  const program = new Command();

  program
    .name("brunogen")
    .description(
      "Generate Bruno collections from Laravel, Express.js, and Go API source code.",
    )
    .version(packageJson.version);

  program
    .command("init")
    .description("Create a brunogen config file in the current directory.")
    .option("-f, --force", "overwrite an existing config file")
    .action(async (options: { force?: boolean }) => {
      await runCommand(async () => {
        const cwd = process.cwd();
        const configFile = path.join(cwd, "brunogen.config.json");
        const exists = await fileExists(configFile);

        if (exists && !options.force) {
          throw new Error(
            `Config already exists at ${configFile}. Use --force to overwrite it.`,
          );
        }

        await writeTextFile(configFile, renderDefaultConfigFile());
        console.log(`Created ${configFile}`);
      });
    });

  program
    .command("generate")
    .description(
      "Scan the current project and generate OpenAPI plus selected output formats.",
    )
    .option("-c, --config <path>", "path to brunogen config")
    .option(
      "-f, --format <formats>",
      "comma-separated output formats: bruno,ai,mcp,all",
    )
    .action(async (options: { config?: string; format?: string }) => {
      await runGenerate(options.config, options.format);
    });

  program
    .command("watch")
    .description("Watch the current project and regenerate on source changes.")
    .option("-c, --config <path>", "path to brunogen config")
    .action(async (options: { config?: string }) => {
      await runCommand(async () => {
        const chokidar = await import("chokidar");
        const cwd = process.cwd();
        const { config, configPath } = await loadConfig(cwd, options.config);
        const projectRoot = resolveFromConfigRoot(
          configPath,
          config.inputRoot,
          cwd,
        );
        const openApiPath = resolveFromConfigRoot(
          configPath,
          config.output.openapiFile,
          cwd,
        );
        const outputPaths = resolveArtifactOutputPaths(configPath, config, cwd);
        const formats = resolveOutputFormats(config);
        const { watchPaths, ignored } = resolveWatchGlobs({
          projectRoot,
          config,
          configPath,
          openApiPath,
          brunoDir: outputPaths.brunoDir,
          aiDir: outputPaths.aiDir,
          mcpDir: outputPaths.mcpDir,
        });

        let timer: NodeJS.Timeout | undefined;

        const rerun = async () => {
          try {
            const artifacts = await generateArtifacts(projectRoot, config);
            const validationWarnings = await collectValidationWarnings(
              artifacts.openApi,
            );
            await writeArtifacts(artifacts, config, outputPaths, formats);
            console.log(
              `[${new Date().toISOString()}] generated ${artifacts.normalized.endpoints.length} endpoints (${formats.join(", ")})`,
            );
            for (const line of [
              ...formatWarnings(artifacts.warnings),
              ...validationWarnings,
            ]) {
              console.warn(line);
            }
          } catch (error) {
            console.error(formatErrorMessage(error));
          }
        };

        await rerun();

        const watcher = chokidar.watch(watchPaths, {
          ignoreInitial: true,
          ignored,
        });

        const schedule = () => {
          if (timer) {
            clearTimeout(timer);
          }
          timer = setTimeout(() => {
            void rerun();
          }, 200);
        };

        watcher.on("add", schedule);
        watcher.on("change", schedule);
        watcher.on("unlink", schedule);

        console.log("Watching for changes...");
      });
    });

  program
    .command("validate")
    .description("Validate generated OpenAPI output for the current project.")
    .option("-c, --config <path>", "path to brunogen config")
    .action(async (options: { config?: string }) => {
      await runCommand(async () => {
        const cwd = process.cwd();
        const { config, configPath } = await loadConfig(cwd, options.config);
        const projectRoot = resolveFromConfigRoot(
          configPath,
          config.inputRoot,
          cwd,
        );
        const artifacts = await generateArtifacts(projectRoot, config);
        await validateOpenApi(artifacts.openApi);
        const consistencyWarnings = collectOpenApiConsistencyWarnings(
          artifacts.openApi,
        );
        if (consistencyWarnings.length > 0) {
          for (const line of consistencyWarnings) {
            console.error(line);
          }
          throw new Error("OpenAPI consistency checks failed.");
        }
        console.log(
          `OpenAPI valid. ${artifacts.normalized.endpoints.length} endpoints scanned.`,
        );
        for (const line of formatWarnings(artifacts.warnings)) {
          console.warn(line);
        }
      });
    });

  program
    .command("doctor")
    .description("Show brunogen environment and framework detection details.")
    .option("-c, --config <path>", "path to brunogen config")
    .action(async (options: { config?: string }) => {
      await runCommand(async () => {
        const cwd = process.cwd();
        const { config, configPath } = await loadConfig(cwd, options.config);
        const result = await runDoctor(cwd, config, configPath);
        for (const line of result.lines) {
          console.log(line);
        }
      });
    });

  const skill = program
    .command("skill")
    .description("Install the bundled brunogen-api agent skill.");

  skill
    .command("install")
    .description("Install the brunogen-api skill for Grok.")
    .option(
      "--target <target>",
      "install target: grok-user (default) or grok-project",
      "grok-user",
    )
    .option("-f, --force", "overwrite an existing skill directory")
    .action(async (options: { target?: string; force?: boolean }) => {
      await runCommand(async () => {
        const target = options.target === "grok-project" ? "grok-project" : "grok-user";
        const result = await installBundledSkill({
          startDir: path.dirname(__filename),
          target,
          projectRoot: process.cwd(),
          force: options.force,
        });

        console.log(`Installed brunogen-api skill to ${result.targetDir}`);
        console.log(`Source: ${result.sourceDir}`);
        console.log("Grok should reload skills automatically within a few seconds.");
      });
    });

  program.parse(process.argv);
}

async function runGenerate(configFile?: string, formatOption?: string): Promise<void> {
  await runCommand(async () => {
    const cwd = process.cwd();
    const { config, configPath } = await loadConfig(cwd, configFile);
    const projectRoot = resolveFromConfigRoot(configPath, config.inputRoot, cwd);
    const outputPaths = resolveArtifactOutputPaths(configPath, config, cwd);
    const formats = resolveOutputFormats(config, formatOption);
    const artifacts = await generateArtifacts(projectRoot, config);
    const validationWarnings = await collectValidationWarnings(
      artifacts.openApi,
    );
    await writeArtifacts(artifacts, config, outputPaths, formats);

    console.log(
      `Generated ${artifacts.normalized.endpoints.length} endpoints.`,
    );
    console.log(`OpenAPI: ${outputPaths.openApiPath}`);
    for (const format of formats) {
      console.log(`${format}: ${formatOutputPath(format, outputPaths)}`);
    }

    for (const line of [
      ...formatWarnings(artifacts.warnings),
      ...validationWarnings,
    ]) {
      console.warn(line);
    }
  });
}

function resolveArtifactOutputPaths(
  configPath: string | null,
  config: Awaited<ReturnType<typeof loadConfig>>["config"],
  cwd: string,
): ArtifactOutputPaths {
  return {
    openApiPath: resolveFromConfigRoot(
      configPath,
      config.output.openapiFile,
      cwd,
    ),
    brunoDir: resolveFromConfigRoot(
      configPath,
      config.output.brunoDir,
      cwd,
    ),
    aiDir: resolveFromConfigRoot(
      configPath,
      config.output.aiDir,
      cwd,
    ),
    mcpDir: resolveFromConfigRoot(
      configPath,
      config.output.mcpDir,
      cwd,
    ),
  };
}

function formatOutputPath(
  format: "bruno" | "ai" | "mcp",
  paths: ArtifactOutputPaths,
): string {
  switch (format) {
    case "bruno":
      return paths.brunoDir;
    case "ai":
      return paths.aiDir;
    case "mcp":
      return paths.mcpDir;
  }
}

async function runCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(formatErrorMessage(error));
    process.exitCode = 1;
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectValidationWarnings(
  openApi: Record<string, unknown>,
): Promise<string[]> {
  try {
    await validateOpenApi(openApi);
    return collectOpenApiConsistencyWarnings(openApi);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      `[OPENAPI_VALIDATION_FAILED] OpenAPI validation failed, but partial artifacts were still written. ${message}`,
    ];
  }
}
