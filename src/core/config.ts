import path from "node:path";
import { promises as fs } from "node:fs";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { defaultWatchExclude, defaultWatchInclude } from "./watch";
import type { BrunogenConfig } from "./model";

const configSchema = z.object({
  version: z.literal(1).default(1),
  framework: z.enum(["auto", "laravel", "gin", "fiber", "echo", "express"]).default("auto"),
  inputRoot: z.string().default("."),
  output: z.object({
    openapiFile: z.string().default(".brunogen/openapi.yaml"),
    brunoDir: z.string().default(".brunogen/bruno"),
  }).default({
    openapiFile: ".brunogen/openapi.yaml",
    brunoDir: ".brunogen/bruno",
  }),
  project: z.object({
    name: z.string().optional(),
    version: z.string().default("1.0.0"),
    serverUrl: z.string().default("{{baseUrl}}"),
  }).default({
    version: "1.0.0",
    serverUrl: "{{baseUrl}}",
  }),
  environments: z.array(z.object({
    name: z.string().min(1),
    variables: z.record(z.string(), z.string()),
  })).default([
    {
      name: "local",
      variables: {
        baseUrl: "http://localhost:8000",
        authToken: "",
      },
    },
  ]),
  watch: z.object({
    include: z.array(z.string().min(1)).default(defaultWatchInclude),
    exclude: z.array(z.string().min(1)).default(defaultWatchExclude),
  }).default({
    include: defaultWatchInclude,
    exclude: defaultWatchExclude,
  }),
  auth: z.object({
    default: z.enum(["auto", "none", "bearer", "basic", "apiKey"]).default("auto"),
    bearerTokenVar: z.string().default("authToken"),
    basicUsernameVar: z.string().default("username"),
    basicPasswordVar: z.string().default("password"),
    apiKeyVar: z.string().default("apiKey"),
    apiKeyName: z.string().default("X-API-Key"),
    apiKeyLocation: z.enum(["header", "query"]).default("header"),
    middlewarePatterns: z.object({
      bearer: z.array(z.string().min(1)).default([]),
    }).default({
      bearer: [],
    }),
  }).default({
    default: "auto",
    bearerTokenVar: "authToken",
    basicUsernameVar: "username",
    basicPasswordVar: "password",
    apiKeyVar: "apiKey",
    apiKeyName: "X-API-Key",
    apiKeyLocation: "header",
    middlewarePatterns: {
      bearer: [],
    },
  }),
});

const configFiles = [
  "brunogen.config.json",
  "brunogen.config.yaml",
  "brunogen.config.yml",
];

export function defaultConfig(): BrunogenConfig {
  return structuredClone(configSchema.parse({}));
}

export async function findConfigFile(cwd: string): Promise<string | null> {
  for (const candidate of configFiles) {
    const absolutePath = path.join(cwd, candidate);
    try {
      await fs.access(absolutePath);
      return absolutePath;
    } catch {
      continue;
    }
  }

  return null;
}

export async function loadConfig(cwd: string, explicitPath?: string): Promise<{ config: BrunogenConfig; configPath: string | null; }> {
  const configPath = explicitPath ? path.resolve(cwd, explicitPath) : await findConfigFile(cwd);

  if (!configPath) {
    return {
      config: defaultConfig(),
      configPath: null,
    };
  }

  const rawContent = await fs.readFile(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = configPath.endsWith(".json")
      ? JSON.parse(rawContent)
      : parseYaml(rawContent);
  } catch (error) {
    throw new Error(
      `Invalid brunogen config at ${configPath}: ${formatErrorMessage(error)}`,
    );
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(formatConfigValidationError(configPath, result.error));
  }

  return {
    config: structuredClone(result.data),
    configPath,
  };
}

export function resolveFromConfigRoot(configPath: string | null, value: string, cwd: string): string {
  const baseDirectory = configPath ? path.dirname(configPath) : cwd;
  return path.resolve(baseDirectory, value);
}

export function renderDefaultConfigFile(): string {
  return `${JSON.stringify(defaultConfig(), null, 2)}\n`;
}

function formatConfigValidationError(configPath: string, error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const location = issue.path.length > 0 ? issue.path.join(".") : "config";
    return `- ${location}: ${issue.message}`;
  });

  return [
    `Invalid brunogen config at ${configPath}:`,
    ...issues,
  ].join("\n");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
