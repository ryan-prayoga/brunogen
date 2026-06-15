import type { GenerationWarning, SchemaObject } from "./model";

export interface OpenApiOperationRecord {
  pathname: string;
  method: string;
  operationId: string;
  summary: string;
  tags: string[];
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header";
    required?: boolean;
    schema?: SchemaObject;
    description?: string;
  }>;
  requestBody?: {
    content?: Record<string, { schema?: SchemaObject; }>;
  };
  responses?: Record<string, {
    description?: string;
    content?: Record<string, {
      schema?: SchemaObject;
      example?: unknown;
    }>;
  }>;
  security?: Array<Record<string, string[]>>;
  source?: {
    file: string;
    line?: number;
  };
  warnings: GenerationWarning[];
}

export function listOpenApiOperations(
  openApi: Record<string, unknown>,
): OpenApiOperationRecord[] {
  const paths = (openApi.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const operations: OpenApiOperationRecord[] = [];

  for (const [pathname, pathItem] of Object.entries(paths)) {
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) {
        continue;
      }

      const operation = rawOperation as OpenApiOperationRecord & Record<string, unknown>;
      operations.push({
        pathname,
        method,
        operationId: String(operation.operationId ?? `${method}_${pathname}`),
        summary: String(operation.summary ?? `${method.toUpperCase()} ${pathname}`),
        tags: Array.isArray(operation.tags) ? operation.tags.map(String) : [],
        parameters: Array.isArray(operation.parameters)
          ? operation.parameters as OpenApiOperationRecord["parameters"]
          : [],
        requestBody: operation.requestBody as OpenApiOperationRecord["requestBody"],
        responses: operation.responses as OpenApiOperationRecord["responses"],
        security: operation.security as OpenApiOperationRecord["security"],
        source: operation["x-brunogen-source"] as OpenApiOperationRecord["source"],
        warnings: Array.isArray(operation["x-brunogen-warnings"])
          ? operation["x-brunogen-warnings"] as GenerationWarning[]
          : [],
      });
    }
  }

  return operations;
}

export function extractSecuritySchemes(
  openApi: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const components = (openApi.components ?? {}) as {
    securitySchemes?: Record<string, Record<string, unknown>>;
  };
  return components.securitySchemes ?? {};
}

export function openApiProjectMeta(openApi: Record<string, unknown>): {
  title: string;
  version: string;
  serverUrl: string;
} {
  const info = (openApi.info ?? {}) as { title?: string; version?: string; };
  const servers = Array.isArray(openApi.servers) ? openApi.servers : [];
  const firstServer = (servers[0] ?? {}) as { url?: string; };

  return {
    title: String(info.title ?? "API"),
    version: String(info.version ?? "1.0.0"),
    serverUrl: String(firstServer.url ?? "http://localhost:8000"),
  };
}

export function schemaToJsonSchema(schema?: SchemaObject): Record<string, unknown> {
  if (!schema) {
    return { type: "object", properties: {} };
  }

  const result: Record<string, unknown> = {};

  if (schema.type) {
    result.type = schema.type;
  }

  if (schema.format) {
    result.format = schema.format;
  }

  if (schema.description) {
    result.description = schema.description;
  }

  if (schema.enum) {
    result.enum = schema.enum;
  }

  if (schema.items) {
    result.items = schemaToJsonSchema(schema.items);
  }

  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [
        name,
        schemaToJsonSchema(property),
      ]),
    );
  }

  if (schema.required) {
    result.required = schema.required;
  }

  if (schema.additionalProperties !== undefined) {
    result.additionalProperties = schema.additionalProperties;
  }

  if (schema.nullable) {
    result.nullable = true;
  }

  if (schema.default !== undefined) {
    result.default = schema.default;
  }

  if (!result.type && !result.properties && !result.items) {
    result.type = "object";
    result.properties = {};
  }

  return result;
}

export function buildToolInputSchema(operation: OpenApiOperationRecord): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of operation.parameters) {
    properties[parameter.name] = {
      ...schemaToJsonSchema(parameter.schema),
      description: parameter.description ?? `${parameter.in} parameter`,
    };

    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  const requestBodySchema = extractRequestBodySchema(operation.requestBody);
  if (requestBodySchema) {
    properties.body = {
      ...schemaToJsonSchema(requestBodySchema),
      description: "Request body",
    };
    required.push("body");
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
}

function extractRequestBodySchema(
  requestBody?: OpenApiOperationRecord["requestBody"],
): SchemaObject | undefined {
  if (!requestBody?.content) {
    return undefined;
  }

  const preferred = requestBody.content["application/json"]
    ?? requestBody.content["application/x-www-form-urlencoded"]
    ?? requestBody.content["multipart/form-data"]
    ?? Object.values(requestBody.content)[0];

  return preferred?.schema;
}

function isHttpMethod(method: string): boolean {
  return ["get", "post", "put", "patch", "delete", "head", "options"].includes(method);
}