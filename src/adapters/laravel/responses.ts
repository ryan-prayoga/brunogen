import { promises as fs } from "node:fs";

import { dedupeResponsesByStatusCode } from "../../core/dedupe";
import {
  extractBalanced,
  findTopLevelTerminator,
  splitTopLevel,
} from "../../core/parsing";
import type { NormalizedResponse, SchemaObject } from "../../core/model";
import {
  createPhpExampleContext,
  inferSchemaFromExample,
  parsePhpExampleValue,
  type PhpExampleContext,
} from "./examples";
import {
  type LaravelResourceSchema,
  type PhpClassRecord,
  extractReturnArray,
  parsePhpString,
  shortPhpClassName,
} from "./shared";

export async function extractLaravelResponses(
  methodBody: string,
  classIndex: Map<string, PhpClassRecord>,
  controllerContent: string,
  baseContext?: PhpExampleContext,
  depth = 0,
): Promise<NormalizedResponse[]> {
  const responses = new Map<string, NormalizedResponse>();
  const exampleContext = createPhpExampleContext(
    methodBody,
    baseContext?.assignments,
  );

  for (const jsonCall of extractReturnResponseJsonCalls(methodBody)) {
    const args = splitTopLevel(jsonCall.slice(1, -1), ",");
    if (args.length === 0) {
      continue;
    }

    const example = parsePhpExampleValue(args[0], exampleContext);
    const statusCode = parseLaravelStatusCode(args[1]) ?? "200";
    responses.set(statusCode, {
      statusCode,
      description: "Inferred JSON response",
      contentType: "application/json",
      schema: inferSchemaFromExample(example),
      example,
    });
  }

  if (depth < 2) {
    for (const helperResponse of await extractLaravelHelperResponses(
      methodBody,
      classIndex,
      controllerContent,
      exampleContext,
      depth,
    )) {
      if (!responses.has(helperResponse.statusCode)) {
        responses.set(helperResponse.statusCode, helperResponse);
      }
    }
  }

  for (const noContentCall of extractReturnResponseNoContentCalls(methodBody)) {
    const args = splitTopLevel(noContentCall.slice(1, -1), ",");
    const statusCode = parseLaravelStatusCode(args[0]) ?? "204";
    responses.set(statusCode, {
      statusCode,
      description: "Inferred empty response",
    });
  }

  for (const abortResponse of extractLaravelAbortResponses(methodBody)) {
    if (!responses.has(abortResponse.statusCode)) {
      responses.set(abortResponse.statusCode, abortResponse);
    }
  }

  if (hasLaravelNotFoundPattern(methodBody) && !responses.has("404")) {
    responses.set("404", {
      statusCode: "404",
      description: "Inferred not found response",
      contentType: "application/json",
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
      example: {
        message: "Not Found",
      },
    });
  }

  for (const exceptionResponse of extractLaravelExceptionResponses(
    methodBody,
    exampleContext,
  )) {
    if (!responses.has(exceptionResponse.statusCode)) {
      responses.set(exceptionResponse.statusCode, exceptionResponse);
    }
  }

  for (const arrayLiteral of extractDirectReturnArrays(methodBody)) {
    const example = parsePhpExampleValue(arrayLiteral, exampleContext);
    const statusCode = "200";
    if (!responses.has(statusCode)) {
      responses.set(statusCode, {
        statusCode,
        description: "Inferred array response",
        contentType: "application/json",
        schema: inferSchemaFromExample(example),
        example,
      });
    }
  }

  const resourceResponses = await extractLaravelResourceResponses(
    methodBody,
    classIndex,
    exampleContext,
  );
  for (const response of resourceResponses) {
    if (!responses.has(response.statusCode)) {
      responses.set(response.statusCode, response);
    }
  }

  return [...responses.values()];
}

function extractLaravelAbortResponses(
  methodBody: string,
): NormalizedResponse[] {
  const responses = new Map<string, NormalizedResponse>();

  for (const abortCall of extractLaravelAbortCalls(methodBody)) {
    const args = splitTopLevel(abortCall.slice(1, -1), ",");
    const statusCode = parseLaravelStatusCode(args[0]) ?? "500";
    const message =
      parsePhpString(args[1] ?? "") ?? defaultAbortMessage(statusCode);
    responses.set(statusCode, {
      statusCode,
      description: "Inferred abort response",
      contentType: "application/json",
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
      example: {
        message,
      },
    });
  }

  return [...responses.values()];
}

function extractLaravelExceptionResponses(
  methodBody: string,
  exampleContext: PhpExampleContext,
): NormalizedResponse[] {
  const responses = new Map<string, NormalizedResponse>();

  for (const validationErrors of extractLaravelValidationExceptionExamples(
    methodBody,
    exampleContext,
  )) {
    responses.set("422", {
      statusCode: "422",
      description: "Inferred validation exception response",
      contentType: "application/json",
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
          errors: inferSchemaFromExample(validationErrors),
        },
      },
      example: {
        message: "The given data was invalid.",
        errors: validationErrors,
      },
    });
  }

  return [...responses.values()];
}

async function extractLaravelResourceResponses(
  methodBody: string,
  classIndex: Map<string, PhpClassRecord>,
  exampleContext: PhpExampleContext,
): Promise<NormalizedResponse[]> {
  const responses: NormalizedResponse[] = [];
  const returnStatements = extractReturnStatements(methodBody);

  for (const statement of returnStatements) {
    const parsedResourceReturn = parseLaravelResourceReturnStatement(
      statement,
      exampleContext,
    );
    if (!parsedResourceReturn) {
      continue;
    }

    const resourceResponse = await buildLaravelResourceResponse(
      parsedResourceReturn.resourceType,
      parsedResourceReturn.mode,
      classIndex,
      parsedResourceReturn.additional,
    );
    if (resourceResponse) {
      responses.push(resourceResponse);
    }
  }

  return dedupeResponsesByStatusCode(responses);
}

async function buildLaravelResourceResponse(
  resourceType: string,
  mode: "single" | "collection",
  classIndex: Map<string, PhpClassRecord>,
  additional?: unknown,
): Promise<NormalizedResponse | undefined> {
  const resourceSchema = await parseLaravelResourceSchema(
    resourceType,
    classIndex,
  );
  if (!resourceSchema) {
    return undefined;
  }

  const additionalProperties =
    additional && typeof additional === "object" && !Array.isArray(additional)
      ? (additional as Record<string, unknown>)
      : undefined;
  const additionalSchema = additionalProperties
    ? inferSchemaFromExample(additionalProperties)
    : undefined;
  const wrappedSchema: SchemaObject =
    mode === "collection"
      ? {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: resourceSchema.schema,
            },
            ...(additionalSchema?.properties ?? {}),
          },
        }
      : {
          type: "object",
          properties: {
            data: resourceSchema.schema,
            ...(additionalSchema?.properties ?? {}),
          },
        };
  const wrappedExample =
    mode === "collection"
      ? { data: [resourceSchema.example], ...(additionalProperties ?? {}) }
      : { data: resourceSchema.example, ...(additionalProperties ?? {}) };

  return {
    statusCode: "200",
    description: "Inferred Laravel resource response",
    contentType: "application/json",
    schema: wrappedSchema,
    example: wrappedExample,
  };
}

async function parseLaravelResourceSchema(
  resourceType: string,
  classIndex: Map<string, PhpClassRecord>,
): Promise<LaravelResourceSchema | undefined> {
  const resourceRecord = classIndex.get(shortPhpClassName(resourceType));
  if (!resourceRecord) {
    return undefined;
  }

  const content = await fs.readFile(resourceRecord.filePath, "utf8");
  const methodMatch = /function\s+toArray\s*\(([^)]*)\)/m.exec(content);
  if (!methodMatch) {
    return undefined;
  }

  const bodyStartIndex = content.indexOf("{", methodMatch.index);
  const body =
    bodyStartIndex >= 0
      ? extractBalanced(content, bodyStartIndex, "{", "}")
      : null;
  if (!body) {
    return undefined;
  }

  const arrayLiteral =
    extractDirectReturnArrays(body)[0] ?? extractReturnArray(body);
  if (!arrayLiteral) {
    return undefined;
  }

  const example = parsePhpExampleValue(
    arrayLiteral,
    createPhpExampleContext(body),
  );
  return {
    schema: inferSchemaFromExample(example),
    example,
  };
}

function parseLaravelResourceReturnStatement(
  statement: string,
  exampleContext: PhpExampleContext,
):
  | {
      resourceType: string;
      mode: "single" | "collection";
      additional?: unknown;
    }
  | undefined {
  const newResourceMatch = statement.match(
    /^return\s+new\s+([A-Za-z0-9_\\]+)\s*\(/,
  );
  if (newResourceMatch?.[1]) {
    return {
      resourceType: newResourceMatch[1],
      mode: "single",
      additional: extractLaravelResourceAdditional(statement, exampleContext),
    };
  }

  const factoryMatch = statement.match(
    /^return\s+([A-Za-z0-9_\\]+)::(make|collection)\s*\(/,
  );
  if (factoryMatch?.[1] && factoryMatch[2]) {
    return {
      resourceType: factoryMatch[1],
      mode: factoryMatch[2] === "collection" ? "collection" : "single",
      additional: extractLaravelResourceAdditional(statement, exampleContext),
    };
  }

  return undefined;
}

function extractLaravelResourceAdditional(
  statement: string,
  exampleContext: PhpExampleContext,
): unknown | undefined {
  const additionalIndex = statement.indexOf("->additional(");
  if (additionalIndex < 0) {
    return undefined;
  }

  const openParenIndex = statement.indexOf(
    "(",
    additionalIndex + "->additional".length,
  );
  const argsBlock =
    openParenIndex >= 0
      ? extractBalanced(statement, openParenIndex, "(", ")")
      : null;
  if (!argsBlock) {
    return undefined;
  }

  const firstArg = splitTopLevel(argsBlock.slice(1, -1), ",")[0]?.trim();
  if (!firstArg) {
    return undefined;
  }

  const additional = parsePhpExampleValue(firstArg, exampleContext);
  return additional &&
    typeof additional === "object" &&
    !Array.isArray(additional)
    ? additional
    : undefined;
}

function extractReturnStatements(methodBody: string): string[] {
  const statements: string[] = [];
  let offset = 0;

  while (offset < methodBody.length) {
    const returnIndex = methodBody.indexOf("return", offset);
    if (returnIndex < 0) {
      break;
    }

    const statementEnd = findTopLevelTerminator(methodBody, returnIndex, [";"]);
    if (statementEnd < 0) {
      break;
    }

    statements.push(methodBody.slice(returnIndex, statementEnd + 1).trim());
    offset = statementEnd + 1;
  }

  return statements;
}

function extractReturnResponseJsonCalls(methodBody: string): string[] {
  const results: string[] = [];
  let offset = 0;

  while (offset < methodBody.length) {
    const returnIndex = methodBody.indexOf("return response()->json(", offset);
    if (returnIndex < 0) {
      break;
    }

    const openParenIndex = methodBody.indexOf(
      "(",
      returnIndex + "return response()->json".length,
    );
    const argsBlock =
      openParenIndex >= 0
        ? extractBalanced(methodBody, openParenIndex, "(", ")")
        : null;
    if (!argsBlock) {
      break;
    }

    results.push(argsBlock);
    offset = openParenIndex + argsBlock.length;
  }

  return results;
}

function extractLaravelAbortCalls(methodBody: string): string[] {
  const results: string[] = [];
  const patterns = ["abort(", "abort_if(", "abort_unless("];

  for (const pattern of patterns) {
    let offset = 0;
    while (offset < methodBody.length) {
      const callIndex = methodBody.indexOf(pattern, offset);
      if (callIndex < 0) {
        break;
      }

      const openParenIndex = methodBody.indexOf(
        "(",
        callIndex + pattern.length - 1,
      );
      const argsBlock =
        openParenIndex >= 0
          ? extractBalanced(methodBody, openParenIndex, "(", ")")
          : null;
      if (!argsBlock) {
        break;
      }

      if (pattern === "abort(") {
        results.push(argsBlock);
      } else {
        const args = splitTopLevel(argsBlock.slice(1, -1), ",");
        if (args.length >= 2) {
          results.push(`(${args.slice(1).join(",")})`);
        }
      }

      offset = openParenIndex + argsBlock.length;
    }
  }

  return results;
}

function extractLaravelValidationExceptionExamples(
  methodBody: string,
  exampleContext: PhpExampleContext,
): Record<string, unknown>[] {
  const examples: Record<string, unknown>[] = [];
  let offset = 0;

  while (offset < methodBody.length) {
    const callIndex = methodBody.indexOf(
      "ValidationException::withMessages(",
      offset,
    );
    if (callIndex < 0) {
      break;
    }

    const openParenIndex = methodBody.indexOf(
      "(",
      callIndex + "ValidationException::withMessages".length,
    );
    const argsBlock =
      openParenIndex >= 0
        ? extractBalanced(methodBody, openParenIndex, "(", ")")
        : null;
    if (!argsBlock) {
      break;
    }

    const firstArg = splitTopLevel(argsBlock.slice(1, -1), ",")[0]?.trim();
    if (firstArg) {
      const parsed = parsePhpExampleValue(firstArg, exampleContext);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        examples.push(parsed as Record<string, unknown>);
      }
    }

    offset = openParenIndex + argsBlock.length;
  }

  return examples;
}

async function extractLaravelHelperResponses(
  methodBody: string,
  classIndex: Map<string, PhpClassRecord>,
  controllerContent: string,
  exampleContext: PhpExampleContext,
  depth: number,
): Promise<NormalizedResponse[]> {
  const responses: NormalizedResponse[] = [];

  for (const statement of extractReturnStatements(methodBody)) {
    const helperCall = parseLaravelHelperReturnStatement(statement);
    if (!helperCall) {
      continue;
    }

    const helperMethod = findPhpMethod(
      controllerContent,
      helperCall.methodName,
    );
    if (!helperMethod) {
      continue;
    }

    const seedAssignments = new Map(exampleContext.assignments);
    helperMethod.params.forEach((paramName, index) => {
      const argExpression = helperCall.args[index];
      if (argExpression) {
        seedAssignments.set(paramName, argExpression);
      }
    });

    responses.push(
      ...(await extractLaravelResponses(
        helperMethod.body,
        classIndex,
        controllerContent,
        createPhpExampleContext(helperMethod.body, seedAssignments),
        depth + 1,
      )),
    );
  }

  return dedupeResponsesByStatusCode(responses);
}

function parseLaravelHelperReturnStatement(
  statement: string,
): { methodName: string; args: string[] } | undefined {
  const helperMatch = statement.match(
    /^return\s+(?:\$this->|self::)([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
  );
  if (!helperMatch?.[1]) {
    return undefined;
  }

  const openParenIndex = statement.indexOf("(", helperMatch[0].length - 1);
  const argsBlock =
    openParenIndex >= 0
      ? extractBalanced(statement, openParenIndex, "(", ")")
      : null;
  if (!argsBlock) {
    return undefined;
  }

  return {
    methodName: helperMatch[1],
    args: splitTopLevel(argsBlock.slice(1, -1), ","),
  };
}

function findPhpMethod(
  content: string,
  methodName: string,
): { params: string[]; body: string } | undefined {
  const methodMatch = new RegExp(
    `function\\s+${methodName}\\s*\\(([^)]*)\\)`,
    "m",
  ).exec(content);
  if (!methodMatch) {
    return undefined;
  }

  const bodyStartIndex = content.indexOf("{", methodMatch.index);
  const body =
    bodyStartIndex >= 0
      ? extractBalanced(content, bodyStartIndex, "{", "}")
      : null;
  if (!body) {
    return undefined;
  }

  return {
    params: extractPhpParamNames(methodMatch[1] ?? ""),
    body,
  };
}

function extractPhpParamNames(params: string): string[] {
  return params
    .split(",")
    .map((param) => param.trim().match(/\$([A-Za-z_][A-Za-z0-9_]*)/)?.[1])
    .filter((value): value is string => Boolean(value));
}

function hasLaravelNotFoundPattern(methodBody: string): boolean {
  return /\b(?:findOrFail|firstOrFail)\s*\(/.test(methodBody);
}

function extractReturnResponseNoContentCalls(methodBody: string): string[] {
  const results: string[] = [];
  let offset = 0;

  while (offset < methodBody.length) {
    const returnIndex = methodBody.indexOf(
      "return response()->noContent(",
      offset,
    );
    if (returnIndex < 0) {
      break;
    }

    const openParenIndex = methodBody.indexOf(
      "(",
      returnIndex + "return response()->noContent".length,
    );
    const argsBlock =
      openParenIndex >= 0
        ? extractBalanced(methodBody, openParenIndex, "(", ")")
        : null;
    if (!argsBlock) {
      break;
    }

    results.push(argsBlock);
    offset = openParenIndex + argsBlock.length;
  }

  return results;
}

function extractDirectReturnArrays(methodBody: string): string[] {
  const results: string[] = [];
  let offset = 0;

  while (offset < methodBody.length) {
    const returnIndex = methodBody.indexOf("return [", offset);
    if (returnIndex < 0) {
      break;
    }

    const openBracketIndex = methodBody.indexOf("[", returnIndex);
    const arrayBlock =
      openBracketIndex >= 0
        ? extractBalanced(methodBody, openBracketIndex, "[", "]")
        : null;
    if (!arrayBlock) {
      break;
    }

    results.push(arrayBlock);
    offset = openBracketIndex + arrayBlock.length;
  }

  return results;
}

function parseLaravelStatusCode(rawValue?: string): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  const statusMap: Record<string, string> = {
    "Response::HTTP_OK": "200",
    "Response::HTTP_CREATED": "201",
    "Response::HTTP_NO_CONTENT": "204",
    "Response::HTTP_BAD_REQUEST": "400",
    "Response::HTTP_UNAUTHORIZED": "401",
    "Response::HTTP_FORBIDDEN": "403",
    "Response::HTTP_NOT_FOUND": "404",
    "Response::HTTP_UNPROCESSABLE_ENTITY": "422",
    "Response::HTTP_INTERNAL_SERVER_ERROR": "500",
  };

  return statusMap[trimmed];
}

function defaultAbortMessage(statusCode: string): string {
  const statusText = defaultStatusTextMap[statusCode];
  return statusText ?? "Request failed";
}

const defaultStatusTextMap: Record<string, string> = {
  "400": "Bad Request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not Found",
  "409": "Conflict",
  "422": "Unprocessable Entity",
  "500": "Internal Server Error",
};
