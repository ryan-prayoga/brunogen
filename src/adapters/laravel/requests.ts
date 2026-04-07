import { promises as fs } from "node:fs";

import { extractBalanced, splitTopLevel } from "../../core/parsing";
import type {
  GenerationWarning,
  NormalizedParameter,
  NormalizedRequestBody,
  NormalizedResponse,
  SchemaObject,
} from "../../core/model";
import { extractLaravelResponses, parsePhpExampleValue } from "./responses";
import {
  type ControllerAnalysis,
  type ParsedHandler,
  type PhpClassRecord,
  dedupeStrings,
  extractReturnArray,
  parsePhpString,
  parsePhpStringList,
  shortPhpClassName,
  splitOnce,
} from "./shared";

export async function analyzeControllerHandler(
  handler: ParsedHandler | undefined,
  classIndex: Map<string, PhpClassRecord>,
  controllerCache: Map<string, ControllerAnalysis>,
): Promise<ControllerAnalysis> {
  if (!handler?.controller || !handler.action) {
    return {
      queryParameters: [],
      headerParameters: [],
      responses: [],
      warnings: [],
    };
  }

  const cacheKey = `${handler.controller}:${handler.action}`;
  const cached = controllerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const controllerRecord = classIndex.get(handler.controller);
  if (!controllerRecord) {
    const warning = {
      code: "LARAVEL_CONTROLLER_NOT_FOUND",
      message: `Could not locate controller ${handler.controller} while inferring request schema.`,
    };
    const result = {
      queryParameters: [],
      headerParameters: [],
      responses: [],
      warnings: [warning],
    };
    controllerCache.set(cacheKey, result);
    return result;
  }

  const content = await fs.readFile(controllerRecord.filePath, "utf8");
  const methodMatch = new RegExp(
    `function\\s+${handler.action}\\s*\\(([^)]*)\\)`,
    "m",
  ).exec(content);
  if (!methodMatch) {
    const warning = {
      code: "LARAVEL_CONTROLLER_METHOD_NOT_FOUND",
      message: `Could not locate ${handler.controller}::${handler.action} while inferring request schema.`,
      location: { file: controllerRecord.filePath },
    };
    const result = {
      queryParameters: [],
      headerParameters: [],
      responses: [],
      warnings: [warning],
    };
    controllerCache.set(cacheKey, result);
    return result;
  }

  const params = methodMatch[1] ?? "";
  const firstRequestType = extractFirstRequestType(params);
  const bodyStartIndex = content.indexOf("{", methodMatch.index);
  const body =
    bodyStartIndex >= 0
      ? extractBalanced(content, bodyStartIndex, "{", "}")
      : null;
  const warnings: GenerationWarning[] = [];
  let requestBody: NormalizedRequestBody | undefined;
  let queryParameters: NormalizedParameter[] = [];
  let headerParameters: NormalizedParameter[] = [];
  let responses: NormalizedResponse[] = [];

  if (firstRequestType && firstRequestType !== "Request") {
    const requestSchema = await parseFormRequestSchema(
      firstRequestType,
      classIndex,
    );
    if (requestSchema) {
      requestBody = {
        contentType: "application/json" as const,
        schema: requestSchema,
      };
    }
  }

  if (body) {
    const inlineRules = extractInlineValidationRules(body);
    if (inlineRules) {
      requestBody = {
        contentType: "application/json" as const,
        schema: buildLaravelSchemaFromRules(inlineRules),
      };
    }

    const manualRequestSchema = await extractLaravelManualRequestSchema(
      body,
      classIndex,
    );
    if (manualRequestSchema) {
      requestBody = mergeLaravelRequestBodies(requestBody, manualRequestSchema);
    }

    queryParameters = extractLaravelQueryParameters(body);
    headerParameters = extractLaravelHeaderParameters(body);
    responses = await extractLaravelResponses(body, classIndex, content);
  }

  const result = {
    requestBody,
    queryParameters,
    headerParameters,
    responses,
    warnings,
  };
  controllerCache.set(cacheKey, result);
  return result;
}

function extractFirstRequestType(params: string): string | undefined {
  const paramMatches = params.split(",").map((entry) => entry.trim());
  for (const param of paramMatches) {
    const match = param.match(/([A-Za-z0-9_\\]+)\s+\$[A-Za-z0-9_]+/);
    if (match?.[1]) {
      return shortPhpClassName(match[1]);
    }
  }

  return undefined;
}

async function parseFormRequestSchema(
  requestType: string,
  classIndex: Map<string, PhpClassRecord>,
): Promise<SchemaObject | undefined> {
  const requestRecord = classIndex.get(requestType);
  if (!requestRecord) {
    return undefined;
  }

  const content = await fs.readFile(requestRecord.filePath, "utf8");
  const rulesMethodMatch = /function\s+rules\s*\([^)]*\)/m.exec(content);
  if (!rulesMethodMatch) {
    return undefined;
  }

  const methodBodyStart = content.indexOf("{", rulesMethodMatch.index);
  if (methodBodyStart < 0) {
    return undefined;
  }

  const methodBody = extractBalanced(content, methodBodyStart, "{", "}");
  if (!methodBody) {
    return undefined;
  }

  const rules = extractReturnArray(methodBody);
  if (!rules) {
    return undefined;
  }

  return buildLaravelSchemaFromRules(parsePhpRulesArray(rules));
}

function extractInlineValidationRules(
  methodBody: string,
): Record<string, string[]> | undefined {
  const validateCallIndex = methodBody.search(/->validate\s*\(/);
  if (validateCallIndex >= 0) {
    const arrayStart = methodBody.indexOf("[", validateCallIndex);
    if (arrayStart >= 0) {
      const arrayBody = extractBalanced(methodBody, arrayStart, "[", "]");
      if (arrayBody) {
        return parsePhpRulesArray(arrayBody);
      }
    }
  }

  const validatorCallIndex = methodBody.search(/Validator::make\s*\(/);
  if (validatorCallIndex >= 0) {
    const arrayStart = methodBody.indexOf("[", validatorCallIndex);
    if (arrayStart >= 0) {
      const arrayBody = extractBalanced(methodBody, arrayStart, "[", "]");
      if (arrayBody) {
        return parsePhpRulesArray(arrayBody);
      }
    }
  }

  return undefined;
}

function parsePhpRulesArray(arrayBody: string): Record<string, string[]> {
  const inner = arrayBody.slice(1, -1);
  const entries = splitTopLevel(inner, ",");
  const result: Record<string, string[]> = {};

  for (const entry of entries) {
    if (!entry.includes("=>")) {
      continue;
    }

    const [rawKey, rawValue] = splitOnce(entry, "=>");
    const key = parsePhpString(rawKey.trim());
    if (!key) {
      continue;
    }

    result[key] = parseRuleValue(rawValue.trim());
  }

  return result;
}

function parseRuleValue(rawValue: string): string[] {
  const singleRule = parsePhpString(rawValue);
  if (singleRule) {
    return singleRule
      .split("|")
      .map((rule) => rule.trim())
      .filter(Boolean);
  }

  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    return parsePhpStringList(rawValue)
      .flatMap((rule) => rule.split("|"))
      .map((rule) => rule.trim())
      .filter(Boolean);
  }

  return [];
}

function buildLaravelSchemaFromRules(
  ruleMap: Record<string, string[]>,
): SchemaObject {
  const properties: Record<string, SchemaObject> = {};
  const required: string[] = [];

  for (const [fieldName, rules] of Object.entries(ruleMap)) {
    if (fieldName.includes(".")) {
      continue;
    }

    const schema: SchemaObject = {};
    let inferredType: string | undefined;

    for (const rule of rules) {
      const [name, rawArgument] = splitRule(rule);
      switch (name) {
        case "required":
          required.push(fieldName);
          break;
        case "string":
          inferredType = "string";
          break;
        case "integer":
        case "int":
          inferredType = "integer";
          break;
        case "numeric":
          inferredType = "number";
          break;
        case "boolean":
          inferredType = "boolean";
          break;
        case "array":
          inferredType = "array";
          schema.items = { type: "string" };
          break;
        case "email":
          inferredType = "string";
          schema.format = "email";
          break;
        case "uuid":
          inferredType = "string";
          schema.format = "uuid";
          break;
        case "date":
        case "date_format":
          inferredType = "string";
          schema.format = "date-time";
          break;
        case "nullable":
          schema.nullable = true;
          break;
        case "min":
          applyLaravelRange(schema, inferredType, rawArgument, "min");
          break;
        case "max":
          applyLaravelRange(schema, inferredType, rawArgument, "max");
          break;
        case "in":
          inferredType = inferredType ?? "string";
          schema.enum = rawArgument
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
          break;
        default:
          break;
      }
    }

    schema.type = inferredType ?? schema.type ?? "string";
    properties[fieldName] = schema;
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? [...new Set(required)] : undefined,
  };
}

function applyLaravelRange(
  schema: SchemaObject,
  inferredType: string | undefined,
  rawArgument: string,
  kind: "min" | "max",
): void {
  const numericValue = Number.parseFloat(rawArgument);
  if (Number.isNaN(numericValue)) {
    return;
  }

  if (inferredType === "integer" || inferredType === "number") {
    if (kind === "min") {
      schema.minimum = numericValue;
    } else {
      schema.maximum = numericValue;
    }
    return;
  }

  if (kind === "min") {
    schema.minLength = numericValue;
  } else {
    schema.maxLength = numericValue;
  }
}

function splitRule(rule: string): [string, string] {
  const [name, ...rest] = rule.split(":");
  return [name.trim(), rest.join(":").trim()];
}

function extractLaravelQueryParameters(
  methodBody: string,
): NormalizedParameter[] {
  const parameters = new Set<string>();

  for (const match of methodBody.matchAll(
    /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*query\s*\(\s*['"]([^'"]+)['"]/g,
  )) {
    if (match[1]) {
      parameters.add(match[1]);
    }
  }

  return [...parameters].map((name) => ({
    name,
    in: "query",
    required: false,
    schema: { type: "string" },
  }));
}

function extractLaravelHeaderParameters(
  methodBody: string,
): NormalizedParameter[] {
  const parameters = new Set<string>();

  for (const match of methodBody.matchAll(
    /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*header\s*\(\s*['"]([^'"]+)['"]/g,
  )) {
    if (match[1]) {
      parameters.add(match[1]);
    }
  }

  for (const match of methodBody.matchAll(
    /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*headers\s*->\s*get\s*\(\s*['"]([^'"]+)['"]/g,
  )) {
    if (match[1]) {
      parameters.add(match[1]);
    }
  }

  return [...parameters].map((name) => ({
    name,
    in: "header",
    required: false,
    schema: { type: "string" },
  }));
}

async function extractLaravelManualRequestSchema(
  methodBody: string,
  classIndex: Map<string, PhpClassRecord>,
): Promise<SchemaObject | undefined> {
  const properties: Record<string, SchemaObject> = {};

  const accessorPatterns: Array<{
    regex: RegExp;
    schemaFactory: () => SchemaObject;
  }> = [
    {
      regex:
        /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*(?:input|get|post|json|string)\s*\(\s*['"]([^'"]+)['"]/g,
      schemaFactory: () => ({ type: "string" }),
    },
    {
      regex:
        /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*integer\s*\(\s*['"]([^'"]+)['"]/g,
      schemaFactory: () => ({ type: "integer" }),
    },
    {
      regex:
        /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*(?:float|double)\s*\(\s*['"]([^'"]+)['"]/g,
      schemaFactory: () => ({ type: "number" }),
    },
    {
      regex:
        /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*boolean\s*\(\s*['"]([^'"]+)['"]/g,
      schemaFactory: () => ({ type: "boolean" }),
    },
    {
      regex:
        /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*(?:has|filled)\s*\(\s*['"]([^'"]+)['"]/g,
      schemaFactory: () => ({ type: "boolean" }),
    },
    {
      regex:
        /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*(?:array|collect)\s*\(\s*['"]([^'"]+)['"]/g,
      schemaFactory: () => ({ type: "array", items: { type: "string" } }),
    },
    {
      regex:
        /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*date\s*\(\s*['"]([^'"]+)['"]/g,
      schemaFactory: () => ({ type: "string", format: "date-time" }),
    },
    {
      regex: /request\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      schemaFactory: () => ({ type: "string" }),
    },
  ];

  for (const pattern of accessorPatterns) {
    for (const match of methodBody.matchAll(pattern.regex)) {
      const fieldName = match[1];
      if (!fieldName || fieldName.includes(".")) {
        continue;
      }

      properties[fieldName] = mergeSchemaObjects(
        properties[fieldName],
        pattern.schemaFactory(),
      );
    }
  }

  for (const match of methodBody.matchAll(
    /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))(?:\s*->\s*safe\s*\(\s*\))?\s*->\s*only\s*\(\s*(\[[^\]]*\])\s*\)/g,
  )) {
    const arrayLiteral = match[1];
    if (!arrayLiteral) {
      continue;
    }

    for (const fieldName of parsePhpStringList(arrayLiteral)) {
      if (!fieldName || fieldName.includes(".")) {
        continue;
      }

      properties[fieldName] = mergeSchemaObjects(properties[fieldName], {
        type: "string",
      });
    }
  }

  for (const match of methodBody.matchAll(
    /(?:\$[A-Za-z_][A-Za-z0-9_]*|request\(\))\s*->\s*enum\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_\\]+)::class/g,
  )) {
    const fieldName = match[1];
    const enumType = match[2];
    if (!fieldName || !enumType || fieldName.includes(".")) {
      continue;
    }

    const enumValues = await parseLaravelEnumValues(enumType, classIndex);
    properties[fieldName] = mergeSchemaObjects(
      properties[fieldName],
      enumValues.length > 0
        ? {
            type: typeof enumValues[0] === "number" ? "number" : "string",
            enum: enumValues,
          }
        : { type: "string" },
    );
  }

  if (Object.keys(properties).length === 0) {
    return undefined;
  }

  return {
    type: "object",
    properties,
  };
}

function mergeLaravelRequestBodies(
  existing: NormalizedRequestBody | undefined,
  manualSchema: SchemaObject,
): NormalizedRequestBody {
  if (!existing) {
    return {
      contentType: "application/json",
      schema: manualSchema,
    };
  }

  return {
    ...existing,
    schema: mergeSchemaObjects(existing.schema, manualSchema),
  };
}

function mergeSchemaObjects(
  left: SchemaObject | undefined,
  right: SchemaObject | undefined,
): SchemaObject {
  if (!left) {
    return right ?? {};
  }

  if (!right) {
    return left;
  }

  const mergedProperties = {
    ...(left.properties ?? {}),
    ...(right.properties ?? {}),
  };

  return {
    ...left,
    ...right,
    properties:
      Object.keys(mergedProperties).length > 0 ? mergedProperties : undefined,
    required: dedupeStrings([
      ...(left.required ?? []),
      ...(right.required ?? []),
    ]),
  };
}

async function parseLaravelEnumValues(
  enumType: string,
  classIndex: Map<string, PhpClassRecord>,
): Promise<Array<string | number>> {
  const enumRecord = classIndex.get(shortPhpClassName(enumType));
  if (!enumRecord) {
    return [];
  }

  const content = await fs.readFile(enumRecord.filePath, "utf8");
  const values: Array<string | number> = [];

  for (const match of content.matchAll(
    /\bcase\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:=\s*([^;]+))?;/g,
  )) {
    const rawValue = match[1]?.trim();
    if (!rawValue) {
      continue;
    }

    const parsed = parsePhpExampleValue(rawValue);
    if (typeof parsed === "string" || typeof parsed === "number") {
      values.push(parsed);
    }
  }

  return values;
}
