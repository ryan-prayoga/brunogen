import path from "node:path";
import { promises as fs } from "node:fs";

import { stringify as stringifyYaml } from "yaml";

import { ensureDirectory, removeDirectory, sanitizeFileName, writeTextFile } from "./fs";
import type { BrunogenConfig, SchemaObject } from "./model";

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: "path" | "query" | "header";
    required?: boolean;
    schema?: SchemaObject;
  }>;
  requestBody?: {
    content?: Record<string, { schema?: SchemaObject; }>;
  };
  responses?: Record<string, {
    description?: string;
    content?: Record<string, {
      schema?: SchemaObject;
      example?: unknown;
      examples?: Record<string, {
        summary?: string;
        description?: string;
        value?: unknown;
      }>;
    }>;
  }>;
  security?: Array<Record<string, string[]>>;
}

interface BrunoRequestExampleData {
  url: string;
  method: string;
  bodyMode?: "json" | "form-urlencoded" | "multipart-form";
  queryParams: Array<{ name: string; value: string; }>;
  pathParams: Array<{ name: string; value: string; }>;
  headers: Array<{ name: string; value: string; }>;
  bodyContent?: string;
}

interface BrunoResponseExampleData {
  name: string;
  description?: string;
  statusCode: string;
  contentType?: string;
  body?: unknown;
}

export async function writeOpenApiFile(openApi: Record<string, unknown>, outputFile: string): Promise<void> {
  const content = stringifyYaml(openApi, {
    sortMapEntries: false,
  });
  await writeTextFile(outputFile, content);
}

export async function writeBrunoCollection(
  openApi: Record<string, unknown>,
  outputDirectory: string,
  config: BrunogenConfig,
): Promise<void> {
  await resetBrunoOutputDirectory(outputDirectory);

  const collectionName = extractCollectionName(openApi);
  await writeTextFile(path.join(outputDirectory, "bruno.json"), JSON.stringify({
    version: "1",
    name: collectionName,
    type: "collection",
    ignore: ["node_modules", ".git"],
  }, null, 2) + "\n");

  const pathsObject = (openApi.paths ?? {}) as Record<string, Record<string, OpenApiOperation>>;
  let sequence = 1;

  for (const [pathname, operations] of Object.entries(pathsObject)) {
    for (const [method, rawOperation] of Object.entries(operations)) {
      const operation = rawOperation as OpenApiOperation;
      const folderName = sanitizeFileName(operation.tags?.[0] ?? pathname.split("/").filter(Boolean)[0] ?? "default");
      const folderPath = path.join(outputDirectory, folderName);
      const requestName = operation.operationId ?? operation.summary ?? `${method.toUpperCase()} ${pathname}`;
      const fileName = `${sanitizeFileName(requestName)}.bru`;

      await ensureDirectory(folderPath);
      await writeTextFile(path.join(folderPath, fileName), renderRequestFile({
        pathname,
        method,
        operation,
        sequence,
        config,
      }));
      sequence += 1;
    }
  }

  const environmentsDirectory = path.join(outputDirectory, "environments");
  await ensureDirectory(environmentsDirectory);

  for (const environment of config.environments) {
    await writeTextFile(
      path.join(environmentsDirectory, `${sanitizeFileName(environment.name)}.bru`),
      renderEnvironmentFile(environment.variables),
    );
  }
}

async function resetBrunoOutputDirectory(outputDirectory: string): Promise<void> {
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  const rootDirectory = path.parse(resolvedOutputDirectory).root;

  if (resolvedOutputDirectory === rootDirectory) {
    throw new Error(
      `Refusing to clear Bruno output directory at filesystem root: ${resolvedOutputDirectory}`,
    );
  }

  try {
    const entries = await fs.readdir(resolvedOutputDirectory, {
      withFileTypes: true,
    });
    if (
      entries.length > 0 &&
      !entries.some((entry) => entry.isFile() && entry.name === "bruno.json")
    ) {
      throw new Error(
        `Refusing to clear non-empty Bruno output directory '${resolvedOutputDirectory}' because it does not look like a Brunogen collection. Point output.brunoDir to a dedicated directory or empty it first.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await removeDirectory(outputDirectory);
  await ensureDirectory(outputDirectory);
}

function renderRequestFile(input: {
  pathname: string;
  method: string;
  operation: OpenApiOperation;
  sequence: number;
  config: BrunogenConfig;
}): string {
  const { pathname, method, operation, sequence, config } = input;
  const effectiveAuth = resolveOperationAuth(operation, config);
  const contentType = extractContentType(operation);
  const requestBodySchema = extractRequestSchema(operation);
  const pathParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "path");
  const queryParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "query");
  const headerParameters = (operation.parameters ?? []).filter((parameter) => parameter.in === "header");

  const lines: string[] = [];

  lines.push("meta {");
  lines.push(`  name: ${escapeBruScalar(operation.operationId ?? operation.summary ?? `${method.toUpperCase()} ${pathname}`)}`);
  lines.push("  type: http");
  lines.push(`  seq: ${sequence}`);
  if (operation.tags?.length) {
    lines.push("  tags: [");
    for (const tag of operation.tags) {
      lines.push(`    ${escapeBruScalar(tag)}`);
    }
    lines.push("  ]");
  }
  lines.push("}");
  lines.push("");

  lines.push(`${method.toLowerCase()} {`);
  lines.push(`  url: {{baseUrl}}${toBruPath(pathname)}`);
  lines.push(`  body: ${contentType ?? "none"}`);
  lines.push(`  auth: ${effectiveAuth.mode}`);
  lines.push("}");

  if (pathParameters.length > 0) {
    lines.push("");
    lines.push("params:path {");
    for (const parameter of pathParameters) {
      lines.push(`  ${parameter.name}: ${renderPlaceholderValue(parameter.name, parameter.schema)}`);
    }
    lines.push("}");
  }

  if (queryParameters.length > 0) {
    lines.push("");
    lines.push("params:query {");
    for (const parameter of queryParameters) {
      lines.push(`  ${parameter.name}: ${renderPlaceholderValue(parameter.name, parameter.schema)}`);
    }
    lines.push("}");
  }

  const headers = buildHeaders(headerParameters, contentType);
  if (headers.length > 0) {
    lines.push("");
    lines.push("headers {");
    for (const header of headers) {
      lines.push(`  ${header.name}: ${header.value}`);
    }
    lines.push("}");
  }

  if (effectiveAuth.block) {
    lines.push("");
    lines.push(...effectiveAuth.block);
  }

  if (requestBodySchema && contentType === "json") {
    lines.push("");
    lines.push("body:json {");
    lines.push(indent(JSON.stringify(buildExampleFromSchema(requestBodySchema), null, 2), 2));
    lines.push("}");
  }

  if (requestBodySchema && contentType === "form-urlencoded") {
    lines.push("");
    lines.push("body:form-urlencoded {");
    for (const [key, value] of Object.entries(buildFlatFormExample(requestBodySchema))) {
      lines.push(`  ${key}: ${value}`);
    }
    lines.push("}");
  }

  if (requestBodySchema && contentType === "multipart-form") {
    lines.push("");
    lines.push("body:multipart-form {");
    for (const [key, value] of Object.entries(buildFlatFormExample(requestBodySchema))) {
      lines.push(`  ${key}: ${value}`);
    }
    lines.push("}");
  }

  const requestExample = buildBrunoRequestExampleData({
    pathname,
    method,
    contentType,
    requestBodySchema,
    pathParameters,
    queryParameters,
    headers,
  });
  const responseExamples = extractBrunoResponseExamples(operation);
  for (const responseExample of responseExamples) {
    lines.push("");
    lines.push(...renderBrunoExampleBlock(responseExample, requestExample));
  }

  return `${lines.join("\n")}\n`;
}

function renderEnvironmentFile(variables: Record<string, string>): string {
  const lines = ["vars {"];
  for (const [key, value] of Object.entries(variables)) {
    lines.push(`  ${key}: ${escapeBruScalar(value)}`);
  }
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function extractCollectionName(openApi: Record<string, unknown>): string {
  const info = (openApi.info ?? {}) as Record<string, unknown>;
  return String(info.title ?? "Brunogen Collection");
}

function resolveOperationAuth(operation: OpenApiOperation, config: BrunogenConfig): { mode: string; block?: string[]; } {
  const security = operation.security?.[0];
  if (!security) {
    return { mode: "none" };
  }

  if ("bearerAuth" in security) {
    return {
      mode: "bearer",
      block: [
        "auth:bearer {",
        `  token: {{${config.auth.bearerTokenVar}}}`,
        "}",
      ],
    };
  }

  if ("basicAuth" in security) {
    return {
      mode: "basic",
      block: [
        "auth:basic {",
        `  username: {{${config.auth.basicUsernameVar}}}`,
        `  password: {{${config.auth.basicPasswordVar}}}`,
        "}",
      ],
    };
  }

  if ("apiKeyAuth" in security) {
    return {
      mode: "apikey",
      block: [
        "auth:apikey {",
        `  key: ${config.auth.apiKeyName}`,
        `  value: {{${config.auth.apiKeyVar}}}`,
        `  placement: ${config.auth.apiKeyLocation === "query" ? "queryParams" : "header"}`,
        "}",
      ],
    };
  }

  return { mode: "none" };
}

function extractContentType(operation: OpenApiOperation): "json" | "form-urlencoded" | "multipart-form" | undefined {
  const contentTypes = Object.keys(operation.requestBody?.content ?? {});
  if (contentTypes.includes("application/json")) {
    return "json";
  }

  if (contentTypes.includes("application/x-www-form-urlencoded")) {
    return "form-urlencoded";
  }

  if (contentTypes.includes("multipart/form-data")) {
    return "multipart-form";
  }

  return undefined;
}

function extractRequestSchema(operation: OpenApiOperation): SchemaObject | undefined {
  const content = operation.requestBody?.content ?? {};
  return content["application/json"]?.schema
    ?? content["application/x-www-form-urlencoded"]?.schema
    ?? content["multipart/form-data"]?.schema;
}

function buildHeaders(
  headerParameters: Array<{ name: string; schema?: SchemaObject; }>,
  contentType?: string,
): Array<{ name: string; value: string; }> {
  const headers: Array<{ name: string; value: string; }> = [{
    name: "accept",
    value: "application/json",
  }];

  if (contentType === "json") {
    headers.push({ name: "content-type", value: "application/json" });
  }

  if (contentType === "form-urlencoded") {
    headers.push({ name: "content-type", value: "application/x-www-form-urlencoded" });
  }

  if (contentType === "multipart-form") {
    headers.push({ name: "content-type", value: "multipart/form-data" });
  }

  for (const parameter of headerParameters) {
    headers.push({
      name: parameter.name,
      value: renderPlaceholderValue(parameter.name, parameter.schema),
    });
  }

  return headers;
}

function buildBrunoRequestExampleData(input: {
  pathname: string;
  method: string;
  contentType?: "json" | "form-urlencoded" | "multipart-form";
  requestBodySchema?: SchemaObject;
  pathParameters: Array<{ name: string; schema?: SchemaObject; }>;
  queryParameters: Array<{ name: string; schema?: SchemaObject; }>;
  headers: Array<{ name: string; value: string; }>;
}): BrunoRequestExampleData {
  const {
    pathname,
    method,
    contentType,
    requestBodySchema,
    pathParameters,
    queryParameters,
    headers,
  } = input;

  let bodyContent: string | undefined;
  if (requestBodySchema && contentType === "json") {
    bodyContent = JSON.stringify(buildExampleFromSchema(requestBodySchema), null, 2);
  }

  if (requestBodySchema && (contentType === "form-urlencoded" || contentType === "multipart-form")) {
    bodyContent = Object.entries(buildFlatFormExample(requestBodySchema))
      .map(([key, value]) => `${escapeBruKey(key)}: ${value}`)
      .join("\n");
  }

  return {
    url: `{{baseUrl}}${toBruPath(pathname)}`,
    method: method.toLowerCase(),
    bodyMode: contentType,
    pathParams: pathParameters.map((parameter) => ({
      name: parameter.name,
      value: renderPlaceholderValue(parameter.name, parameter.schema),
    })),
    queryParams: queryParameters.map((parameter) => ({
      name: parameter.name,
      value: renderPlaceholderValue(parameter.name, parameter.schema),
    })),
    headers,
    bodyContent,
  };
}

function extractBrunoResponseExamples(operation: OpenApiOperation): BrunoResponseExampleData[] {
  const examples: BrunoResponseExampleData[] = [];

  for (const [statusCode, response] of Object.entries(operation.responses ?? {})) {
    const contentEntries = Object.entries(response.content ?? {});
    if (contentEntries.length === 0) {
      examples.push({
        name: `${statusCode} Response`,
        description: response.description,
        statusCode,
      });
      continue;
    }

    for (const [contentType, content] of contentEntries) {
      if (content.examples) {
        for (const [exampleName, example] of Object.entries(content.examples)) {
          examples.push({
            name: example.summary ?? exampleName ?? `${statusCode} Response`,
            description: example.description ?? response.description,
            statusCode,
            contentType,
            body: example.value ?? example,
          });
        }
        continue;
      }

      if (content.example !== undefined) {
        examples.push({
          name: `${statusCode} Response`,
          description: response.description,
          statusCode,
          contentType,
          body: content.example,
        });
        continue;
      }

      if (content.schema) {
        examples.push({
          name: `${statusCode} Response`,
          description: response.description,
          statusCode,
          contentType,
          body: buildExampleFromSchema(content.schema),
        });
      }
    }
  }

  return examples;
}

function renderBrunoExampleBlock(
  responseExample: BrunoResponseExampleData,
  requestExample: BrunoRequestExampleData,
): string[] {
  const lines: string[] = [];

  lines.push("example {");
  lines.push(`  name: ${escapeBruScalar(responseExample.name)}`);
  if (responseExample.description) {
    lines.push(`  description: ${escapeBruScalar(responseExample.description)}`);
  }
  lines.push("");
  lines.push("  request: {");
  lines.push(`    url: ${requestExample.url}`);
  lines.push(`    method: ${requestExample.method}`);
  if (requestExample.bodyMode) {
    lines.push(`    mode: ${requestExample.bodyMode}`);
  }

  if (requestExample.queryParams.length > 0) {
    lines.push("    params:query: {");
    for (const parameter of requestExample.queryParams) {
      lines.push(`      ${escapeBruKey(parameter.name)}: ${parameter.value}`);
    }
    lines.push("    }");
    lines.push("");
  }

  if (requestExample.pathParams.length > 0) {
    lines.push("    params:path: {");
    for (const parameter of requestExample.pathParams) {
      lines.push(`      ${escapeBruKey(parameter.name)}: ${parameter.value}`);
    }
    lines.push("    }");
    lines.push("");
  }

  if (requestExample.headers.length > 0) {
    lines.push("    headers: {");
    for (const header of requestExample.headers) {
      lines.push(`      ${escapeBruKey(header.name)}: ${header.value}`);
    }
    lines.push("    }");
    lines.push("");
  }

  if (requestExample.bodyContent !== undefined && requestExample.bodyMode) {
    lines.push(`    body:${requestExample.bodyMode}: {`);
    lines.push(indent(requestExample.bodyContent, 6));
    lines.push("    }");
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  lines.push("  }");
  lines.push("");
  lines.push("  response: {");

  if (responseExample.contentType) {
    lines.push("    headers: {");
    lines.push(`      Content-Type: ${responseExample.contentType}`);
    lines.push("    }");
    lines.push("");
  }

  lines.push("    status: {");
  lines.push(`      code: ${responseExample.statusCode}`);
  const statusText = getHttpStatusText(responseExample.statusCode);
  if (statusText) {
    lines.push(`      text: ${escapeBruScalar(statusText)}`);
  }
  lines.push("    }");

  if (responseExample.body !== undefined) {
    lines.push("");
    lines.push("    body: {");
    const responseBodyType = inferResponseBodyType(responseExample.contentType);
    if (responseBodyType) {
      lines.push(`      type: ${responseBodyType}`);
    }
    lines.push("      content: '''");
    lines.push(indent(renderExampleBodyContent(responseExample.body), 8));
    lines.push("      '''");
    lines.push("    }");
  }

  lines.push("  }");
  lines.push("}");

  return lines;
}

function buildExampleFromSchema(schema: SchemaObject): unknown {
  if (schema.example !== undefined) {
    return schema.example;
  }

  if (schema.default !== undefined) {
    return schema.default;
  }

  if (schema.enum?.length) {
    return schema.enum[0];
  }

  switch (schema.type) {
    case "object":
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        buildExampleFromSchema(value),
      ]));
    case "array":
      return schema.items ? [buildExampleFromSchema(schema.items)] : [];
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return true;
    case "string":
    default:
      if (schema.format === "email") {
        return "user@example.com";
      }
      if (schema.format === "uuid") {
        return "00000000-0000-0000-0000-000000000000";
      }
      if (schema.format === "date-time") {
        return "2026-01-01T00:00:00Z";
      }
      return "";
  }
}

function buildFlatFormExample(schema: SchemaObject): Record<string, string> {
  const example = buildExampleFromSchema(schema);
  if (!example || typeof example !== "object" || Array.isArray(example)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(example as Record<string, unknown>).map(([key, value]) => [
      key,
      formatBruValue(value),
    ]),
  );
}

function renderPlaceholderValue(name: string, schema?: SchemaObject): string {
  if (!schema) {
    return `{{${name}}}`;
  }

  if (schema.type === "integer" || schema.type === "number") {
    return "1";
  }

  if (schema.type === "boolean") {
    return "true";
  }

  return `{{${name}}}`;
}

function toBruPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ":$1");
}

function inferResponseBodyType(contentType?: string): "json" | "text" | "xml" | undefined {
  if (!contentType) {
    return undefined;
  }

  const normalized = contentType.toLowerCase();
  if (normalized.includes("json")) {
    return "json";
  }
  if (normalized.includes("xml")) {
    return "xml";
  }
  return "text";
}

function getHttpStatusText(statusCode: string): string | undefined {
  const statusMap: Record<string, string> = {
    "200": "OK",
    "201": "Created",
    "202": "Accepted",
    "204": "No Content",
    "400": "Bad Request",
    "401": "Unauthorized",
    "403": "Forbidden",
    "404": "Not Found",
    "409": "Conflict",
    "422": "Unprocessable Entity",
    "500": "Internal Server Error",
  };

  return statusMap[statusCode];
}

function renderExampleBodyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function escapeBruKey(value: string): string {
  if (/[:\"{}\s]/.test(value)) {
    return JSON.stringify(value);
  }

  return value;
}

function escapeBruScalar(value: string): string {
  if (value === "" || /\s/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function formatBruValue(value: unknown): string {
  if (typeof value === "string") {
    return escapeBruScalar(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function indent(input: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return input.split("\n").map((line) => `${prefix}${line}`).join("\n");
}
