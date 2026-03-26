import path from "node:path";
import { promises as fs } from "node:fs";

import { listFiles, toPosixPath } from "../core/fs";
import type {
  GenerationWarning,
  HttpMethod,
  NormalizedAuth,
  NormalizedEndpoint,
  NormalizedParameter,
  NormalizedProject,
  NormalizedRequestBody,
  NormalizedResponse,
  SchemaObject,
} from "../core/model";

interface ExpressFile {
  filePath: string;
  content: string;
}

interface ImportBinding {
  kind: "default" | "named" | "namespace";
  sourceFile: string;
  importedName?: string;
}

interface FileExports {
  defaultExpression?: string;
  defaultObject?: Record<string, string>;
  named: Map<string, string>;
}

interface ExpressFunctionRecord {
  filePath: string;
  name: string;
  params: string[];
  body: string;
}

interface RouterRecord {
  key: string;
  filePath: string;
  name: string;
  kind: "app" | "router";
  routes: RouteRecord[];
  mounts: MountRecord[];
  middleware: string[];
}

interface RouteRecord {
  filePath: string;
  line: number;
  method: HttpMethod;
  path: string;
  middleware: string[];
  handler: string;
}

interface MountRecord {
  line: number;
  path: string;
  middleware: string[];
  routerKey: string;
}

interface HandlerAnalysis {
  requestBody?: NormalizedRequestBody;
  queryParameters: NormalizedParameter[];
  headerParameters: NormalizedParameter[];
  responses: NormalizedResponse[];
  warnings: GenerationWarning[];
}

interface ProjectIndex {
  files: Map<string, ExpressFile>;
  imports: Map<string, Map<string, ImportBinding>>;
  exports: Map<string, FileExports>;
  functions: Map<string, ExpressFunctionRecord>;
  routers: Map<string, RouterRecord>;
}

const httpMethods: HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];
const defaultStatusByMethod: Record<HttpMethod, string> = {
  get: "200",
  post: "201",
  put: "200",
  patch: "200",
  delete: "204",
  head: "200",
  options: "200",
};

export async function scanExpressProject(
  root: string,
  projectName: string,
  projectVersion: string,
): Promise<NormalizedProject> {
  const files = await loadExpressFiles(root);
  const fileMap = new Map(files.map((file) => [file.filePath, file]));
  const filePaths = new Set(fileMap.keys());
  const imports = new Map<string, Map<string, ImportBinding>>();
  const exports = new Map<string, FileExports>();
  const functions = new Map<string, ExpressFunctionRecord>();
  const routers = new Map<string, RouterRecord>();

  for (const file of files) {
    imports.set(file.filePath, parseImports(file, filePaths));
    exports.set(file.filePath, parseExports(file));
    for (const record of parseFunctions(file)) {
      functions.set(createFunctionKey(file.filePath, record.name), record);
    }
  }

  const index: ProjectIndex = {
    files: fileMap,
    imports,
    exports,
    functions,
    routers,
  };

  for (const file of files) {
    for (const router of parseRouters(file, index)) {
      routers.set(router.key, router);
    }
  }

  const incomingRouters = new Set<string>();
  for (const router of routers.values()) {
    for (const mount of router.mounts) {
      incomingRouters.add(mount.routerKey);
    }
  }

  const endpoints: NormalizedEndpoint[] = [];
  const warnings: GenerationWarning[] = [];
  const seenEndpoints = new Set<string>();
  const roots = [...routers.values()].filter((router) => router.kind === "app" || !incomingRouters.has(router.key));

  for (const router of roots) {
    collectRouterEndpoints({
      router,
      index,
      prefix: "",
      inheritedMiddleware: [],
      visited: new Set<string>(),
      endpoints,
      warnings,
      seenEndpoints,
    });
  }

  return {
    framework: "express",
    projectName,
    projectVersion,
    endpoints,
    warnings,
  };
}

async function loadExpressFiles(root: string): Promise<ExpressFile[]> {
  const filePaths = await listFiles(
    root,
    (filePath) => /\.(?:[cm]?js|ts)$/.test(filePath) && !filePath.endsWith(".d.ts"),
    { ignoreDirectories: ["node_modules", ".git", "dist", "coverage"] },
  );

  const files: ExpressFile[] = [];
  for (const filePath of filePaths) {
    files.push({
      filePath,
      content: await fs.readFile(filePath, "utf8"),
    });
  }

  return files;
}

function parseImports(file: ExpressFile, knownFiles: Set<string>): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const match of file.content.matchAll(/import\s+([\s\S]+?)\s+from\s+["'](.+?)["']/g)) {
    const rawBindings = match[1]?.trim();
    const source = match[2];
    if (!rawBindings || !source?.startsWith(".")) {
      continue;
    }

    const sourceFile = resolveLocalModule(file.filePath, source, knownFiles);
    if (!sourceFile) {
      continue;
    }

    if (rawBindings.startsWith("{")) {
      for (const part of splitTopLevel(rawBindings.slice(1, -1), ",")) {
        const parsed = parseImportPart(part);
        if (parsed) {
          bindings.set(parsed.localName, {
            kind: "named",
            importedName: parsed.importedName,
            sourceFile,
          });
        }
      }
      continue;
    }

    if (rawBindings.startsWith("* as ")) {
      const localName = rawBindings.slice(5).trim();
      bindings.set(localName, { kind: "namespace", sourceFile });
      continue;
    }

    const pieces = splitTopLevel(rawBindings, ",");
    const defaultImport = pieces[0]?.trim();
    if (defaultImport) {
      bindings.set(defaultImport, { kind: "default", sourceFile });
    }

    const namedBlock = pieces[1]?.trim();
    if (namedBlock?.startsWith("{") && namedBlock.endsWith("}")) {
      for (const part of splitTopLevel(namedBlock.slice(1, -1), ",")) {
        const parsed = parseImportPart(part);
        if (parsed) {
          bindings.set(parsed.localName, {
            kind: "named",
            importedName: parsed.importedName,
            sourceFile,
          });
        }
      }
    }
  }

  for (const match of file.content.matchAll(/const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(\s*["'](.+?)["']\s*\)/g)) {
    const rawBindings = match[1];
    const source = match[2];
    if (!rawBindings || !source?.startsWith(".")) {
      continue;
    }

    const sourceFile = resolveLocalModule(file.filePath, source, knownFiles);
    if (!sourceFile) {
      continue;
    }

    for (const part of splitTopLevel(rawBindings, ",")) {
      const parsed = parseImportPart(part);
      if (parsed) {
        bindings.set(parsed.localName, {
          kind: "named",
          importedName: parsed.importedName,
          sourceFile,
        });
      }
    }
  }

  for (const match of file.content.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*require\(\s*["'](.+?)["']\s*\)/g)) {
    const localName = match[1];
    const source = match[2];
    if (!localName || !source?.startsWith(".")) {
      continue;
    }

    const sourceFile = resolveLocalModule(file.filePath, source, knownFiles);
    if (!sourceFile) {
      continue;
    }

    bindings.set(localName, { kind: "default", sourceFile });
  }

  return bindings;
}

function parseImportPart(rawPart: string): { importedName: string; localName: string; } | null {
  const part = rawPart.trim();
  if (!part) {
    return null;
  }

  const aliasMatch = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (aliasMatch?.[1] && aliasMatch[2]) {
    return {
      importedName: aliasMatch[1],
      localName: aliasMatch[2],
    };
  }

  const cjsAliasMatch = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/);
  if (cjsAliasMatch?.[1] && cjsAliasMatch[2]) {
    return {
      importedName: cjsAliasMatch[1],
      localName: cjsAliasMatch[2],
    };
  }

  return {
    importedName: part,
    localName: part,
  };
}

function parseExports(file: ExpressFile): FileExports {
  const named = new Map<string, string>();

  for (const match of file.content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (match[1]) {
      named.set(match[1], match[1]);
    }
  }

  for (const match of file.content.matchAll(/export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
    if (match[1]) {
      named.set(match[1], match[1]);
    }
  }

  for (const match of file.content.matchAll(/exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_.]*)/g)) {
    if (match[1] && match[2]) {
      named.set(match[1], match[2]);
    }
  }

  for (const match of file.content.matchAll(/exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:function(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\(|\()/g)) {
    if (match[1]) {
      named.set(match[1], match[1]);
    }
  }

  let defaultExpression: string | undefined;
  let defaultObject: Record<string, string> | undefined;

  const exportDefaultFunctionMatch = file.content.match(/export\s+default\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (exportDefaultFunctionMatch?.[1]) {
    defaultExpression = exportDefaultFunctionMatch[1];
  }

  const exportDefaultMatch = file.content.match(/export\s+default\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;?/);
  if (exportDefaultMatch?.[1] && exportDefaultMatch[1] !== "function") {
    defaultExpression = exportDefaultMatch[1];
  }

  const moduleExportsMatch = file.content.match(/module\.exports\s*=\s*([A-Za-z_][A-Za-z0-9_.]*)\s*;?/);
  if (moduleExportsMatch?.[1]) {
    defaultExpression = moduleExportsMatch[1];
  }

  const namedExportBlock = file.content.match(/export\s*\{\s*([^}]+)\s*\}/);
  if (namedExportBlock?.[1]) {
    for (const part of splitTopLevel(namedExportBlock[1], ",")) {
      const parsed = parseImportPart(part);
      if (parsed) {
        named.set(parsed.localName, parsed.importedName);
      }
    }
  }

  const exportObjectMatch = matchAssignmentObject(file.content, "module.exports");
  if (exportObjectMatch) {
    const parsedObject = parseObjectExportMap(exportObjectMatch);
    defaultObject = parsedObject;
    for (const [name, expression] of Object.entries(parsedObject)) {
      named.set(name, expression);
    }
  }

  const exportDefaultObjectMatch = matchExportDefaultObject(file.content);
  if (exportDefaultObjectMatch) {
    defaultObject = parseObjectExportMap(exportDefaultObjectMatch);
  }

  return {
    defaultExpression,
    defaultObject,
    named,
  };
}

function parseFunctions(file: ExpressFile): ExpressFunctionRecord[] {
  const records: ExpressFunctionRecord[] = [];

  for (const match of file.content.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/g)) {
    const name = match[1];
    const params = match[2];
    const fullMatch = match[0];
    if (!name || params === undefined) {
      continue;
    }

    const braceStart = (match.index ?? 0) + fullMatch.length - 1;
    const block = extractBalanced(file.content, braceStart, "{", "}");
    if (!block) {
      continue;
    }

    records.push({
      filePath: file.filePath,
      name,
      params: parseParamList(params),
      body: block,
    });
  }

  for (const match of file.content.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g)) {
    const name = match[1];
    const params = match[2];
    const fullMatch = match[0];
    if (!name || params === undefined) {
      continue;
    }

    const braceStart = (match.index ?? 0) + fullMatch.length - 1;
    const block = extractBalanced(file.content, braceStart, "{", "}");
    if (!block) {
      continue;
    }

    records.push({
      filePath: file.filePath,
      name,
      params: parseParamList(params),
      body: block,
    });
  }

  for (const match of file.content.matchAll(/exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?function(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\(([^)]*)\)\s*\{/g)) {
    const name = match[1];
    const params = match[2];
    const fullMatch = match[0];
    if (!name || params === undefined) {
      continue;
    }

    const braceStart = (match.index ?? 0) + fullMatch.length - 1;
    const block = extractBalanced(file.content, braceStart, "{", "}");
    if (!block) {
      continue;
    }

    records.push({
      filePath: file.filePath,
      name,
      params: parseParamList(params),
      body: block,
    });
  }

  for (const match of file.content.matchAll(/exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g)) {
    const name = match[1];
    const params = match[2];
    const fullMatch = match[0];
    if (!name || params === undefined) {
      continue;
    }

    const braceStart = (match.index ?? 0) + fullMatch.length - 1;
    const block = extractBalanced(file.content, braceStart, "{", "}");
    if (!block) {
      continue;
    }

    records.push({
      filePath: file.filePath,
      name,
      params: parseParamList(params),
      body: block,
    });
  }

  return records;
}

function parseRouters(file: ExpressFile, index: ProjectIndex): RouterRecord[] {
  const routerKinds = new Map<string, "app" | "router">();
  const routers: RouterRecord[] = [];

  for (const match of file.content.matchAll(/(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*express\s*\(\s*\)/g)) {
    if (match[1]) {
      routerKinds.set(match[1], "app");
    }
  }

  for (const match of file.content.matchAll(/(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:express\s*\.\s*Router|Router)\s*\(\s*\)/g)) {
    if (match[1]) {
      routerKinds.set(match[1], "router");
    }
  }

  for (const [name, kind] of routerKinds) {
    routers.push({
      key: createRouterKey(file.filePath, name),
      filePath: file.filePath,
      name,
      kind,
      routes: parseRoutesForReceiver(file, name),
      mounts: [],
      middleware: [],
    });
  }

  const routerMap = new Map(routers.map((router) => [router.name, router]));
  const localRouterNames = new Set(routerMap.keys());
  for (const router of routers) {
    const calls = parseUseCalls(file, router.name);
    for (const call of calls) {
      const parsed = parseUseCallArguments(call.args, file.filePath, index, localRouterNames);
      if (parsed.routerKeys.length > 0) {
        for (const routerKey of parsed.routerKeys) {
          router.mounts.push({
            line: call.line,
            path: parsed.path,
            middleware: parsed.middleware,
            routerKey,
          });
        }
      } else if (!parsed.path) {
        router.middleware.push(...parsed.middleware);
      }
    }
  }

  // Keep router declarations stable when parsing the same file multiple times.
  return [...routerMap.values()];
}

function parseRoutesForReceiver(file: ExpressFile, receiver: string): RouteRecord[] {
  const routes: RouteRecord[] = [];

  for (const method of httpMethods) {
    for (const call of findMethodCalls(file.content, receiver, method)) {
      const args = splitTopLevel(call.args, ",");
      const rawPath = parseStringLiteral(args[0] ?? "");
      const handler = args.at(-1)?.trim();
      if (!rawPath || !handler) {
        continue;
      }

      routes.push({
        filePath: file.filePath,
        line: call.line,
        method,
        path: rawPath,
        middleware: args.slice(1, -1).map((value) => value.trim()).filter(Boolean),
        handler,
      });
    }
  }

  for (const routeCall of findRouteChainCalls(file.content, receiver)) {
    const routePath = parseStringLiteral(routeCall.pathArgs[0] ?? "");
    if (!routePath) {
      continue;
    }

    for (const chainedCall of routeCall.chainedCalls) {
      const args = splitTopLevel(chainedCall.args, ",");
      const handler = args.at(-1)?.trim();
      if (!handler) {
        continue;
      }

      routes.push({
        filePath: file.filePath,
        line: routeCall.line,
        method: chainedCall.method,
        path: routePath,
        middleware: args.slice(0, -1).map((value) => value.trim()).filter(Boolean),
        handler,
      });
    }
  }

  return routes;
}

function parseUseCalls(file: ExpressFile, receiver: string): Array<{ args: string; line: number; }> {
  return findMethodCalls(file.content, receiver, "use");
}

function findMethodCalls(
  content: string,
  receiver: string,
  method: string,
): Array<{ args: string; line: number; endIndex: number; }> {
  const results: Array<{ args: string; line: number; endIndex: number; }> = [];
  const regex = new RegExp(`\\b${escapeRegExp(receiver)}\\s*\\.\\s*${method}\\s*\\(`, "g");

  for (const match of content.matchAll(regex)) {
    const startIndex = match.index ?? 0;
    const openParenIndex = content.indexOf("(", startIndex);
    const argsBlock = openParenIndex >= 0 ? extractBalanced(content, openParenIndex, "(", ")") : null;
    if (!argsBlock) {
      continue;
    }

    results.push({
      args: argsBlock.slice(1, -1),
      line: lineNumberAt(content, startIndex),
      endIndex: openParenIndex + argsBlock.length,
    });
  }

  return results;
}

function findRouteChainCalls(
  content: string,
  receiver: string,
): Array<{ pathArgs: string[]; chainedCalls: Array<{ method: HttpMethod; args: string; }>; line: number; }> {
  const results: Array<{ pathArgs: string[]; chainedCalls: Array<{ method: HttpMethod; args: string; }>; line: number; }> = [];
  const regex = new RegExp(`\\b${escapeRegExp(receiver)}\\s*\\.\\s*route\\s*\\(`, "g");

  for (const match of content.matchAll(regex)) {
    const startIndex = match.index ?? 0;
    const openParenIndex = content.indexOf("(", startIndex);
    const argsBlock = openParenIndex >= 0 ? extractBalanced(content, openParenIndex, "(", ")") : null;
    if (!argsBlock) {
      continue;
    }

    const chainedCalls: Array<{ method: HttpMethod; args: string; }> = [];
    let cursor = openParenIndex + argsBlock.length;

    while (cursor < content.length) {
      const remainder = content.slice(cursor);
      const chainedMatch = remainder.match(/^\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(/i);
      if (!chainedMatch?.[1]) {
        break;
      }

      const method = chainedMatch[1].toLowerCase() as HttpMethod;
      const methodIndex = cursor + chainedMatch[0].lastIndexOf("(");
      const methodArgs = extractBalanced(content, methodIndex, "(", ")");
      if (!methodArgs) {
        break;
      }

      chainedCalls.push({
        method,
        args: methodArgs.slice(1, -1),
      });

      cursor = methodIndex + methodArgs.length;
    }

    if (chainedCalls.length > 0) {
      results.push({
        pathArgs: splitTopLevel(argsBlock.slice(1, -1), ","),
        chainedCalls,
        line: lineNumberAt(content, startIndex),
      });
    }
  }

  return results;
}

function parseUseCallArguments(argsBlock: string, filePath: string, index: ProjectIndex, localRouterNames: Set<string>): {
  path: string;
  middleware: string[];
  routerKeys: string[];
} {
  const args = splitTopLevel(argsBlock, ",").map((value) => value.trim()).filter(Boolean);
  let pathPrefix = "";
  let offset = 0;

  const literalPath = parseStringLiteral(args[0] ?? "");
  if (literalPath) {
    pathPrefix = literalPath;
    offset = 1;
  }

  const middleware: string[] = [];
  const routerKeys: string[] = [];

  for (const expression of args.slice(offset)) {
    const routerKey = resolveRouterExpression(filePath, expression, index, localRouterNames);
    if (routerKey) {
      routerKeys.push(routerKey);
    } else {
      middleware.push(expression);
    }
  }

  return {
    path: pathPrefix,
    middleware,
    routerKeys,
  };
}

function collectRouterEndpoints(input: {
  router: RouterRecord;
  index: ProjectIndex;
  prefix: string;
  inheritedMiddleware: string[];
  visited: Set<string>;
  endpoints: NormalizedEndpoint[];
  warnings: GenerationWarning[];
  seenEndpoints: Set<string>;
}): void {
  const {
    router,
    index,
    prefix,
    inheritedMiddleware,
    visited,
    endpoints,
    warnings,
    seenEndpoints,
  } = input;

  const visitKey = `${router.key}@${prefix}`;
  if (visited.has(visitKey)) {
    return;
  }
  visited.add(visitKey);

  const currentMiddleware = dedupeValues([...inheritedMiddleware, ...router.middleware]);

  for (const route of router.routes) {
    const fullPath = normalizeExpressPath(joinRoutePath(prefix, route.path));
    const handlerAnalysis = analyzeExpressHandler(route.handler, route.filePath, index);
    const routeMiddleware = dedupeValues([...currentMiddleware, ...route.middleware]);
    const routeWarnings = handlerAnalysis.warnings.map((warning) => ({
      ...warning,
      location: warning.location ?? { file: route.filePath, line: route.line },
    }));
    const endpointId = `${route.method}:${fullPath}:${route.line}`;

    if (seenEndpoints.has(endpointId)) {
      continue;
    }
    seenEndpoints.add(endpointId);

    endpoints.push({
      id: endpointId,
      method: route.method,
      path: fullPath,
      operationId: buildExpressOperationId(route, fullPath),
      summary: `${route.method.toUpperCase()} ${fullPath}`,
      tags: [inferTag(fullPath)],
      parameters: dedupeParameters([
        ...extractPathParameters(fullPath),
        ...handlerAnalysis.queryParameters,
        ...handlerAnalysis.headerParameters,
      ]),
      requestBody: handlerAnalysis.requestBody,
      responses: handlerAnalysis.responses.length > 0
        ? handlerAnalysis.responses
        : buildDefaultResponses(route.method),
      auth: inferAuthFromMiddleware(routeMiddleware),
      source: {
        file: route.filePath,
        line: route.line,
      },
      warnings: routeWarnings,
    });

    warnings.push(...routeWarnings);
  }

  for (const mount of router.mounts) {
    const childRouter = index.routers.get(mount.routerKey);
    if (!childRouter) {
      continue;
    }

    collectRouterEndpoints({
      router: childRouter,
      index,
      prefix: joinRoutePath(prefix, mount.path),
      inheritedMiddleware: dedupeValues([...currentMiddleware, ...mount.middleware]),
      visited: new Set(visited),
      endpoints,
      warnings,
      seenEndpoints,
    });
  }
}

function analyzeExpressHandler(handlerExpression: string, filePath: string, index: ProjectIndex): HandlerAnalysis {
  const inlineHandler = parseInlineHandler(handlerExpression);
  const handlerRecord = inlineHandler ?? resolveHandlerReference(handlerExpression, filePath, index);

  if (!handlerRecord) {
    return {
      queryParameters: [],
      headerParameters: [],
      responses: [],
      warnings: [{
        code: "EXPRESS_HANDLER_NOT_FOUND",
        message: `Could not locate handler ${handlerExpression} while inferring Express request schema.`,
      }],
    };
  }

  const reqName = handlerRecord.params[0] ?? "req";
  const resName = handlerRecord.params[1] ?? "res";
  const bodyFields = extractObjectFieldsFromRequest(handlerRecord.body, reqName, "body");
  const queryFields = extractObjectFieldsFromRequest(handlerRecord.body, reqName, "query");

  return {
    requestBody: bodyFields.length > 0 ? {
      contentType: "application/json",
      schema: {
        type: "object",
        properties: Object.fromEntries(bodyFields.map((field) => [field.name, field.schema])),
        required: bodyFields.filter((field) => field.required).map((field) => field.name),
      },
    } : undefined,
    queryParameters: queryFields.map((field) => ({
      name: field.name,
      in: "query",
      required: false,
      schema: field.schema,
    })),
    headerParameters: extractExpressHeaders(handlerRecord.body, reqName),
    responses: extractExpressResponses(handlerRecord.body, resName),
    warnings: [],
  };
}

function parseInlineHandler(expression: string): ExpressFunctionRecord | null {
  const trimmed = expression.trim();
  const functionMatch = trimmed.match(/^(?:async\s+)?function(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\(([^)]*)\)\s*\{/);
  if (functionMatch?.[1] !== undefined) {
    const braceStart = trimmed.indexOf("{");
    const block = braceStart >= 0 ? extractBalanced(trimmed, braceStart, "{", "}") : null;
    if (!block) {
      return null;
    }

    return {
      filePath: "",
      name: "inlineHandler",
      params: parseParamList(functionMatch[1]),
      body: block,
    };
  }

  const arrowMatch = trimmed.match(/^(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/);
  if (arrowMatch?.[1] !== undefined) {
    const braceStart = trimmed.indexOf("{");
    const block = braceStart >= 0 ? extractBalanced(trimmed, braceStart, "{", "}") : null;
    if (!block) {
      return null;
    }

    return {
      filePath: "",
      name: "inlineHandler",
      params: parseParamList(arrowMatch[1]),
      body: block,
    };
  }

  return null;
}

function resolveHandlerReference(
  expression: string,
  filePath: string,
  index: ProjectIndex,
): ExpressFunctionRecord | null {
  const trimmed = expression.trim().replace(/^await\s+/, "");

  const direct = index.functions.get(createFunctionKey(filePath, trimmed));
  if (direct) {
    return direct;
  }

  const memberMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (memberMatch?.[1] && memberMatch[2]) {
    const importedRecord = resolveImportedMember(filePath, memberMatch[1], memberMatch[2], index);
    if (importedRecord) {
      return importedRecord;
    }
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    const importedRecord = resolveImportedIdentifier(filePath, trimmed, index);
    if (importedRecord) {
      return importedRecord;
    }
  }

  return null;
}

function resolveImportedIdentifier(
  filePath: string,
  identifier: string,
  index: ProjectIndex,
): ExpressFunctionRecord | null {
  const binding = index.imports.get(filePath)?.get(identifier);
  if (!binding) {
    return null;
  }

  if (binding.kind === "named") {
    const expression = index.exports.get(binding.sourceFile)?.named.get(binding.importedName ?? identifier);
    return expression
      ? index.functions.get(createFunctionKey(binding.sourceFile, expression)) ?? null
      : null;
  }

  if (binding.kind === "default") {
    const expression = index.exports.get(binding.sourceFile)?.defaultExpression;
    return expression
      ? index.functions.get(createFunctionKey(binding.sourceFile, expression)) ?? null
      : null;
  }

  return null;
}

function resolveImportedMember(
  filePath: string,
  identifier: string,
  property: string,
  index: ProjectIndex,
): ExpressFunctionRecord | null {
  const binding = index.imports.get(filePath)?.get(identifier);
  if (!binding) {
    return null;
  }

  const targetExports = index.exports.get(binding.sourceFile);
  if (!targetExports) {
    return null;
  }

  const expression = targetExports.defaultObject?.[property] ?? targetExports.named.get(property);
  if (!expression) {
    return null;
  }

  return index.functions.get(createFunctionKey(binding.sourceFile, expression)) ?? null;
}

function resolveRouterExpression(
  filePath: string,
  expression: string,
  index: ProjectIndex,
  localRouterNames: Set<string>,
): string | null {
  const trimmed = expression.trim();

  const binding = index.imports.get(filePath)?.get(trimmed);
  if (binding?.kind === "default") {
    const exportedExpression = index.exports.get(binding.sourceFile)?.defaultExpression;
    if (!exportedExpression || !fileDeclaresRouter(index.files.get(binding.sourceFile), exportedExpression)) {
      return null;
    }

    return createRouterKey(binding.sourceFile, exportedExpression);
  }

  if (localRouterNames.has(trimmed)) {
    return createRouterKey(filePath, trimmed);
  }

  return null;
}

function extractObjectFieldsFromRequest(
  body: string,
  reqName: string,
  target: "body" | "query",
): Array<{ name: string; required: boolean; schema: SchemaObject; }> {
  const fields = new Map<string, { required: boolean; schema: SchemaObject; }>();

  for (const match of body.matchAll(new RegExp(`${escapeRegExp(reqName)}\\.${target}(?:\\?\\.|\\.)\\s*([A-Za-z_][A-Za-z0-9_]*)`, "g"))) {
    if (match[1]) {
      fields.set(match[1], { required: false, schema: { type: "string" } });
    }
  }

  for (const match of body.matchAll(new RegExp(`${escapeRegExp(reqName)}\\.${target}\\[\\s*["'\`]([^"'\\\`]+)["'\`]\\s*\\]`, "g"))) {
    if (match[1]) {
      fields.set(match[1], { required: false, schema: { type: "string" } });
    }
  }

  for (const match of body.matchAll(new RegExp(`(?:const|let|var)\\s+\\{\\s*([^}]+)\\s*\\}\\s*=\\s*${escapeRegExp(reqName)}\\.${target}\\b`, "g"))) {
    const destructured = match[1];
    if (!destructured) {
      continue;
    }

    for (const part of splitTopLevel(destructured, ",")) {
      const field = parseDestructuredField(part);
      if (!field) {
        continue;
      }

      fields.set(field.name, {
        required: field.required && target === "body",
        schema: { type: "string" },
      });
    }
  }

  return [...fields.entries()].map(([name, value]) => ({
    name,
    required: value.required,
    schema: value.schema,
  }));
}

function parseDestructuredField(part: string): { name: string; required: boolean; } | null {
  const cleaned = part.trim();
  if (!cleaned || cleaned.startsWith("...")) {
    return null;
  }

  const withoutDefault = cleaned.split("=")[0]?.trim();
  if (!withoutDefault) {
    return null;
  }

  const name = withoutDefault.split(":")[0]?.trim();
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return null;
  }

  return {
    name,
    required: !cleaned.includes("="),
  };
}

function extractExpressHeaders(body: string, reqName: string): NormalizedParameter[] {
  const headers = new Set<string>();

  for (const match of body.matchAll(new RegExp(`${escapeRegExp(reqName)}\\.(?:get|header)\\(\\s*["'\`]([^"'\\\`]+)["'\`]`, "g"))) {
    if (match[1]) {
      headers.add(match[1]);
    }
  }

  for (const match of body.matchAll(new RegExp(`${escapeRegExp(reqName)}\\.headers\\[\\s*["'\`]([^"'\\\`]+)["'\`]\\s*\\]`, "g"))) {
    if (match[1]) {
      headers.add(match[1]);
    }
  }

  return [...headers].map((name) => ({
    name,
    in: "header",
    required: false,
    schema: { type: "string" },
  }));
}

function extractExpressResponses(body: string, resName: string): NormalizedResponse[] {
  const responses = new Map<string, NormalizedResponse>();

  const statusRegex = new RegExp(`\\b${escapeRegExp(resName)}\\s*\\.\\s*status\\s*\\(\\s*(\\d{3})\\s*\\)\\s*\\.\\s*(json|send)\\s*\\(`, "g");
  for (const match of body.matchAll(statusRegex)) {
    const statusCode = match[1];
    const method = match[2];
    const startIndex = match.index ?? 0;
    const openParenIndex = body.indexOf("(", startIndex + match[0].length - 1);
    const argsBlock = openParenIndex >= 0 ? extractBalanced(body, openParenIndex, "(", ")") : null;
    if (!statusCode || !method || !argsBlock) {
      continue;
    }

    responses.set(statusCode, buildExpressResponse(statusCode, argsBlock.slice(1, -1), method));
  }

  const defaultRegex = new RegExp(`\\b${escapeRegExp(resName)}\\s*\\.\\s*(json|send)\\s*\\(`, "g");
  for (const match of body.matchAll(defaultRegex)) {
    const method = match[1];
    const startIndex = match.index ?? 0;
    const prefix = body.slice(Math.max(0, startIndex - 20), startIndex);
    if (/status\s*\(\s*\d{3}\s*\)\s*\.$/.test(prefix)) {
      continue;
    }

    const openParenIndex = body.indexOf("(", startIndex + match[0].length - 1);
    const argsBlock = openParenIndex >= 0 ? extractBalanced(body, openParenIndex, "(", ")") : null;
    if (!method || !argsBlock || responses.has("200")) {
      continue;
    }

    responses.set("200", buildExpressResponse("200", argsBlock.slice(1, -1), method));
  }

  const sendStatusRegex = new RegExp(`\\b${escapeRegExp(resName)}\\s*\\.\\s*sendStatus\\s*\\(\\s*(\\d{3})\\s*\\)`, "g");
  for (const match of body.matchAll(sendStatusRegex)) {
    const statusCode = match[1];
    if (statusCode && !responses.has(statusCode)) {
      responses.set(statusCode, {
        statusCode,
        description: "Express sendStatus response",
      });
    }
  }

  return [...responses.values()];
}

function buildExpressResponse(statusCode: string, rawArgs: string, method: string): NormalizedResponse {
  const firstArg = splitTopLevel(rawArgs, ",")[0]?.trim();
  const schema = firstArg ? inferSchemaFromJsExpression(firstArg) : undefined;
  const example = firstArg ? buildExampleFromJsExpression(firstArg) : undefined;

  return {
    statusCode,
    description: method === "json" ? "Inferred JSON response" : "Inferred response",
    contentType: method === "json" ? "application/json" : "text/plain",
    schema,
    example,
  };
}

function inferSchemaFromJsExpression(expression: string): SchemaObject | undefined {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed === "null") {
    return { nullable: true };
  }

  if (trimmed === "true" || trimmed === "false") {
    return { type: "boolean" };
  }

  if (/^-?\d+$/.test(trimmed)) {
    return { type: "integer" };
  }

  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return { type: "number" };
  }

  if (parseStringLiteral(trimmed) !== undefined) {
    return { type: "string" };
  }

  if (trimmed.startsWith("[")) {
    const block = extractBalanced(trimmed, 0, "[", "]");
    const firstItem = block ? splitTopLevel(block.slice(1, -1), ",")[0] : undefined;
    return {
      type: "array",
      items: firstItem ? inferSchemaFromJsExpression(firstItem) ?? { type: "string" } : { type: "string" },
    };
  }

  if (trimmed.startsWith("{")) {
    const block = extractBalanced(trimmed, 0, "{", "}");
    if (!block) {
      return { type: "object" };
    }

    const properties: Record<string, SchemaObject> = {};
    for (const entry of splitTopLevel(block.slice(1, -1), ",")) {
      const property = parseObjectLiteralEntry(entry);
      if (!property) {
        continue;
      }

      properties[property.key] = inferSchemaFromJsExpression(property.value) ?? { type: "string" };
    }

    return {
      type: "object",
      properties,
    };
  }

  return { type: "string" };
}

function buildExampleFromJsExpression(expression: string): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed === "null") {
    return null;
  }

  if (trimmed === "true" || trimmed === "false") {
    return trimmed === "true";
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }

  const stringLiteral = parseStringLiteral(trimmed);
  if (stringLiteral !== undefined) {
    return stringLiteral;
  }

  if (trimmed.startsWith("[")) {
    const block = extractBalanced(trimmed, 0, "[", "]");
    if (!block) {
      return [];
    }

    return splitTopLevel(block.slice(1, -1), ",").map((item) => buildExampleFromJsExpression(item));
  }

  if (trimmed.startsWith("{")) {
    const block = extractBalanced(trimmed, 0, "{", "}");
    if (!block) {
      return {};
    }

    const result: Record<string, unknown> = {};
    for (const entry of splitTopLevel(block.slice(1, -1), ",")) {
      const property = parseObjectLiteralEntry(entry);
      if (!property) {
        continue;
      }

      result[property.key] = buildExampleFromJsExpression(property.value);
    }
    return result;
  }

  return "";
}

function parseObjectLiteralEntry(entry: string): { key: string; value: string; } | null {
  const trimmed = entry.trim();
  if (!trimmed || trimmed.startsWith("...")) {
    return null;
  }

  const separatorIndex = findTopLevelSeparator(trimmed, ":");
  if (separatorIndex < 0) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      return { key: trimmed, value: trimmed };
    }
    return null;
  }

  const rawKey = trimmed.slice(0, separatorIndex).trim();
  const key = parseStringLiteral(rawKey) ?? rawKey;
  if (!key) {
    return null;
  }

  return {
    key,
    value: trimmed.slice(separatorIndex + 1).trim(),
  };
}

function inferAuthFromMiddleware(middleware: string[]): NormalizedAuth {
  const joined = middleware.join(" ");
  if (/auth|jwt|token|bearer|oauth|protected|guard/i.test(joined)) {
    return { type: "bearer" };
  }

  return { type: "none" };
}

function buildExpressOperationId(route: RouteRecord, pathname: string): string {
  const handlerPart = route.handler
    .replace(/[^a-zA-Z0-9.]/g, "")
    .replace(/\./g, "");

  if (handlerPart && handlerPart !== "inlineHandler") {
    return handlerPart;
  }

  const pathPart = pathname
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map(capitalize)
    .join("");

  return `${route.method}${pathPart || "Root"}`;
}

function buildDefaultResponses(method: HttpMethod): NormalizedResponse[] {
  return [{
    statusCode: defaultStatusByMethod[method],
    description: "Generated default response",
  }];
}

function normalizeExpressPath(pathname: string): string {
  return pathname
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
    .replace(/\*([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
}

function extractPathParameters(pathname: string): NormalizedParameter[] {
  return [...pathname.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

function dedupeParameters(parameters: NormalizedParameter[]): NormalizedParameter[] {
  const seen = new Set<string>();
  return parameters.filter((parameter) => {
    const key = `${parameter.in}:${parameter.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferTag(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "default";
}

function joinRoutePath(prefix: string, rawPath: string): string {
  const segments = [prefix, rawPath]
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return `/${segments.join("/")}`.replace(/\/+/g, "/");
}

function parseParamList(rawParams: string): string[] {
  return splitTopLevel(rawParams, ",")
    .map((parameter) => parameter.trim())
    .filter(Boolean)
    .map((parameter) => parameter.replace(/^[{[]|[}\]]$/g, "").trim())
    .filter((parameter) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter));
}

function resolveLocalModule(fromFile: string, specifier: string, knownFiles: Set<string>): string | null {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.cjs"),
  ];

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function fileDeclaresRouter(file: ExpressFile | undefined, symbolName: string): boolean {
  if (!file) {
    return false;
  }

  const appRegex = new RegExp(`(?:const|let|var)\\s+${escapeRegExp(symbolName)}\\s*=\\s*express\\s*\\(\\s*\\)`);
  const routerRegex = new RegExp(`(?:const|let|var)\\s+${escapeRegExp(symbolName)}\\s*=\\s*(?:express\\s*\\.\\s*Router|Router)\\s*\\(\\s*\\)`);
  return appRegex.test(file.content) || routerRegex.test(file.content);
}

function matchAssignmentObject(content: string, assignment: string): string | null {
  const regex = new RegExp(`${escapeRegExp(assignment)}\\s*=\\s*\\{`, "g");
  const match = regex.exec(content);
  if (!match) {
    return null;
  }

  const braceStart = content.indexOf("{", match.index);
  return braceStart >= 0 ? extractBalanced(content, braceStart, "{", "}") : null;
}

function matchExportDefaultObject(content: string): string | null {
  const regex = /export\s+default\s+\{/g;
  const match = regex.exec(content);
  if (!match) {
    return null;
  }

  const braceStart = content.indexOf("{", match.index);
  return braceStart >= 0 ? extractBalanced(content, braceStart, "{", "}") : null;
}

function parseObjectExportMap(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of splitTopLevel(block.slice(1, -1), ",")) {
    const entry = parseObjectLiteralEntry(part);
    if (!entry) {
      const bare = part.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(bare)) {
        result[bare] = bare;
      }
      continue;
    }

    result[entry.key] = entry.value;
  }
  return result;
}

function parseStringLiteral(value: string): string | undefined {
  const match = value.trim().match(/^(["'`])([\s\S]*)\1$/);
  return match?.[2];
}

function createFunctionKey(filePath: string, expression: string): string {
  return `${toPosixPath(filePath)}::${expression}`;
}

function createRouterKey(filePath: string, name: string): string {
  return `${toPosixPath(filePath)}::${name}`;
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function findTopLevelSeparator(input: string, separator: string): number {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      if (quote === character) {
        quote = null;
      } else if (!quote) {
        quote = character;
      }
      continue;
    }

    if (quote) {
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
    } else if (character === ")") {
      parenDepth -= 1;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]") {
      bracketDepth -= 1;
    } else if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth -= 1;
    } else if (
      character === separator
      && parenDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function extractBalanced(input: string, startIndex: number, open: string, close: string): string | null {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;

  for (let index = startIndex; index < input.length; index += 1) {
    const character = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      if (quote === character) {
        quote = null;
      } else if (!quote) {
        quote = character;
      }
      continue;
    }

    if (quote) {
      continue;
    }

    if (character === open) {
      depth += 1;
    }

    if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return input.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function splitTopLevel(input: string, separator: string): string[] {
  const results: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;

  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      if (quote === character) {
        quote = null;
      } else if (!quote) {
        quote = character;
      }
      current += character;
      continue;
    }

    if (!quote) {
      if (character === "(") {
        parenDepth += 1;
      } else if (character === ")") {
        parenDepth -= 1;
      } else if (character === "[") {
        bracketDepth += 1;
      } else if (character === "]") {
        bracketDepth -= 1;
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}") {
        braceDepth -= 1;
      } else if (
        character === separator
        && parenDepth === 0
        && bracketDepth === 0
        && braceDepth === 0
      ) {
        if (current.trim()) {
          results.push(current.trim());
        }
        current = "";
        continue;
      }
    }

    current += character;
  }

  if (current.trim()) {
    results.push(current.trim());
  }

  return results;
}

function dedupeValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(input: string): string {
  return input ? `${input[0].toUpperCase()}${input.slice(1)}` : input;
}
