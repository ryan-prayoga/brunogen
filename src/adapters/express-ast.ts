/**
 * AST-based Express.js route scanner and handler analyzer.
 * Uses @typescript-eslint/parser for proper AST parsing of JS/TS files.
 * Falls back to regex-based parsing (via legacy adapter) for unsupported syntax.
 */

import path from "node:path";
import { promises as fs } from "node:fs";

import { inferBearerAuthFromMiddleware } from "../core/auth-middleware";
import { listFiles, toPosixPath } from "../core/fs";
import { dedupeParameters, dedupeResponsesByStatusCode } from "../core/dedupe";
import { splitTopLevel } from "../core/parsing";
import type {
  BrunogenConfig,
  GenerationWarning,
  HttpMethod,
  NormalizedEndpoint,
  NormalizedParameter,
  NormalizedProject,
} from "../core/model";
import {
  analyzeExpressHandler,
  buildExpressProjectIndex,
  type ExpressProjectIndex,
} from "./express";

import {
  ASTRouteInfo,
  RequestAccessPattern,
  ResponseReturnPattern,
} from "../core/ast-types";

// Lazy-load the parser so non-Express flows do not pay startup cost.
let parserModule: typeof import("@typescript-eslint/parser") | null = null;

function getParser() {
  if (!parserModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      parserModule = require("@typescript-eslint/parser");
    } catch {
      throw new Error(
        "AST parser unavailable. Reinstall brunogen to restore Express AST scanning."
      );
    }
  }
  return parserModule as typeof import("@typescript-eslint/parser");
}

function parseWithEslint(
  code: string,
  filePath: string,
) {
  // Try TypeScript parser first, fall back to ecmaVersion only
  const sourceType: "module" | "script" = /\.m?ts$/.test(filePath) ? "module" : "script";

  // Use parseForESLint which returns { ast, services }
  try {
    const mod = getParser();
    if (mod.parseForESLint) {
      const { ast } = mod.parseForESLint(code, {
        filePath,
        ecmaVersion: 2022,
        sourceType,
        comment: true,
        loc: true,
        range: true,
        tokens: true,
      });
      return ast;
    }
  } catch {
    // Fall through
  }

  throw new Error("Could not initialize TypeScript ESTree parser for Express scanning.");
}

// ─── AST Node helpers ──────────────────────────────────────────

interface LocInfo {
  line?: number;
}

function getLoc(node: any): LocInfo {
  return node?.loc?.start ? { line: node.loc.start.line } : {};
}

function getStringValue(node: any): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.quasis?.length > 0)
    return node.quasis[0].value.cooked;
  return null;
}

function getPropertyName(property: any): string | null {
  if (!property) return null;
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal") return String(property.value);
  return null;
}

// ─── Express file loading ──────────────────────────────────────

interface ExpressFile {
  filePath: string;
  content: string;
  ast: any;
}

async function loadExpressAstFiles(
  root: string,
): Promise<ExpressFile[]> {
  const filePaths = await listFiles(
    root,
    (fp) => /\.(?:[cm]?js|ts)$/.test(fp) && !fp.endsWith(".d.ts"),
    { ignoreDirectories: ["node_modules", ".git", "dist", "coverage"] },
  );

  const files: ExpressFile[] = [];
  for (const filePath of filePaths) {
    const content = await fs.readFile(filePath, "utf8");
    let ast: any;
    try {
      ast = parseWithEslint(content, filePath);
    } catch {
      // Skip files that can't be parsed
      continue;
    }
    if (ast) {
      files.push({ filePath, content, ast });
    }
  }
  return files;
}

// ─── Import / Export resolution (AST-based) ────────────────────

interface ImportBinding {
  kind: "default" | "named" | "namespace";
  sourceFile: string;
  importedName?: string;
}

interface ReExportBinding {
  sourceFile: string;
  importedName: string;
}

interface FileExports {
  defaultExpression?: string;
  defaultObject: Map<string, string>;
  named: Map<string, string>;
  reExports: Map<string, ReExportBinding>;
  allReExports: string[];
}

function parseImportsAst(
  file: ExpressFile,
  knownFiles: Set<string>,
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const node of walkAst(file.ast)) {
    if (node.type !== "ImportDeclaration") continue;
    const source = getStringValue(node.source);
    if (!source?.startsWith(".")) continue;

    const sourceFile = resolveLocalModulePath(file.filePath, source, knownFiles) ?? source;

    for (const spec of node.specifiers ?? []) {
      if (spec.type === "ImportDefaultSpecifier") {
        bindings.set(spec.local.name, {
          kind: "default",
          sourceFile,
        });
      } else if (spec.type === "ImportNamespaceSpecifier") {
        bindings.set(spec.local.name, {
          kind: "namespace",
          sourceFile,
        });
      } else if (spec.type === "ImportSpecifier") {
        bindings.set(spec.local.name, {
          kind: "named",
          sourceFile,
          importedName: getPropertyName(spec.imported) ?? undefined,
        });
      }
    }
  }

  // Also handle require() calls: const { x } = require('./y')
  for (const node of walkAst(file.ast)) {
    if (node.type !== "VariableDeclaration") continue;
    for (const decl of node.declarations ?? []) {
      const init = decl.init;
      if (
        init?.type === "CallExpression" &&
        init.callee?.type === "Identifier" &&
        init.callee.name === "require"
      ) {
        const source = getStringValue(init.arguments?.[0]);
        if (!source?.startsWith(".")) continue;
        const sourceFile = resolveLocalModulePath(file.filePath, source, knownFiles) ?? source;

        if (decl.id?.type === "ObjectPattern") {
          for (const prop of decl.id.properties ?? []) {
            const importedName = getPropertyName(prop.key);
            const name = importedName ?? prop.value?.name;
            if (name) {
              bindings.set(name, {
                kind: "named",
                sourceFile,
                importedName: importedName ?? undefined,
              });
            }
          }
        } else if (decl.id?.type === "Identifier") {
          bindings.set(decl.id.name, { kind: "default", sourceFile });
        }
      }
    }
  }

  return bindings;
}

function parseExportsAst(
  file: ExpressFile,
  knownFiles: Set<string>,
): FileExports {
  const named = new Map<string, string>();
  const defaultObject = new Map<string, string>();
  const reExports = new Map<string, ReExportBinding>();
  const allReExports: string[] = [];
  let defaultExpression: string | undefined;

  for (const node of walkAst(file.ast)) {
    if (node.type === "ExportNamedDeclaration") {
      const source = getStringValue(node.source);
      if (source?.startsWith(".")) {
        const sourceFile = resolveLocalModulePath(file.filePath, source, knownFiles) ?? source;
        for (const specifier of node.specifiers ?? []) {
          const importedName = getPropertyName(specifier.local);
          const exportedName = getPropertyName(specifier.exported);
          if (importedName && exportedName) {
            reExports.set(exportedName, { sourceFile, importedName });
          }
        }
        continue;
      }

      const declaration = node.declaration;

      if (declaration?.type === "FunctionDeclaration" && declaration.id?.name) {
        named.set(declaration.id.name, declaration.id.name);
      }

      if (declaration?.type === "VariableDeclaration") {
        for (const decl of declaration.declarations ?? []) {
          if (decl.id?.type === "Identifier") {
            named.set(decl.id.name, decl.id.name);
          }
        }
      }

      for (const specifier of node.specifiers ?? []) {
        const localName = getPropertyName(specifier.local);
        const exportedName = getPropertyName(specifier.exported);
        if (localName && exportedName) {
          named.set(exportedName, localName);
        }
      }
    }

    if (node.type === "ExportAllDeclaration") {
      const source = getStringValue(node.source);
      if (source?.startsWith(".")) {
        allReExports.push(
          resolveLocalModulePath(file.filePath, source, knownFiles) ?? source,
        );
      }
    }

    // export function foo() {}
    if (node.type === "FunctionDeclaration" && node.export) {
      named.set(node.id.name, node.id.name);
    }

    // export const foo = ...
    if (node.type === "VariableDeclaration" && node.export) {
      for (const decl of node.declarations ?? []) {
        if (decl.id?.type === "Identifier") {
          named.set(decl.id.name, decl.id.name);
        }
      }
    }

    // export default ...
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      if (decl?.type === "FunctionDeclaration" && decl.id) {
        defaultExpression = decl.id.name;
        named.set(decl.id.name, decl.id.name);
      } else if (decl?.type === "Identifier") {
        defaultExpression = decl.name;
      } else if (decl?.type === "ObjectExpression") {
        for (const [exportedName, localName] of parseObjectExportMap(decl)) {
          defaultObject.set(exportedName, localName);
        }
      }
    }

    // module.exports = foo
    if (node.type === "AssignmentExpression") {
      const left = node.left;
      if (left?.type === "MemberExpression") {
        const objName = getTargetName(left.object);
        if (objName === "module" && getPropertyName(left.property) === "exports") {
          defaultExpression = getTargetName(node.right) ?? undefined;
          if (node.right?.type === "ObjectExpression") {
            for (const [exportedName, localName] of parseObjectExportMap(node.right)) {
              named.set(exportedName, localName);
              defaultObject.set(exportedName, localName);
            }
          }
        }
        if (objName === "exports") {
          const propName = getPropertyName(left.property);
          if (propName) {
            named.set(propName, getTargetName(node.right) ?? propName);
          }
        }
      }
    }
  }

  return { defaultExpression, defaultObject, named, reExports, allReExports };
}

// ─── Router detection (AST-based) ──────────────────────────────

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

const httpMethods: HttpMethod[] = [
  "get", "post", "put", "patch", "delete", "head", "options",
];

function parseRoutersAst(
  file: ExpressFile,
  fileMap: Map<string, ExpressFile>,
  imports: Map<string, Map<string, ImportBinding>>,
  exports: Map<string, FileExports>,
): RouterRecord[] {
  const routers: RouterRecord[] = [];
  const fileImports = imports.get(file.filePath) ?? new Map();
  const knownFiles = new Set(fileMap.keys());

  for (const node of walkAst(file.ast)) {
    // Router() / express() creation
    if (
      node.type === "VariableDeclarator" &&
      node.init?.type === "CallExpression"
    ) {
      const isApp = isExpressAppCall(node.init);
      const isRouter = isExpressRouterCall(node.init);
      if (isApp || isRouter) {
        const name = node.id?.type === "Identifier" ? node.id.name : "default";
        const kind = isApp ? "app" : "router";

        routers.push({
          key: `${file.filePath}#${name}`,
          filePath: file.filePath,
          name,
          kind,
          routes: [],
          mounts: [],
          middleware: [],
        });
      }
    }

      // app.use('/path', router) — register mounts on the source router
    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (!callee || callee.type !== "MemberExpression") continue;
      const objName = getTargetName(callee.object);
      const propName = getPropertyName(callee.property);

      if (propName === "use") {
        const args = node.arguments ?? [];
        const sourceRouter = routers.find(
          (router) => router.filePath === file.filePath && router.name === objName,
        );
        if (!sourceRouter) continue;

        const firstArgIsPath = getStringValue(args[0]) !== null;
        const mountPath = firstArgIsPath ? getStringValue(args[0]) ?? "" : "";
        const remainingArgs = args.slice(firstArgIsPath ? 1 : 0);
        if (remainingArgs.length === 0) continue;

        const mountTargetArg = remainingArgs.at(-1);
        const targetKey = resolveRouterReference(
          mountTargetArg,
          file.filePath,
          routers,
          fileImports,
          fileMap,
          exports,
        );

        if (!targetKey) {
          for (const middlewareArg of remainingArgs) {
            sourceRouter.middleware.push(...extractMiddlewareNamesFromNode(middlewareArg));
          }
          continue;
        }

        const middlewareArgs = remainingArgs.slice(0, -1);
        sourceRouter.mounts.push({
          line: getLoc(node).line ?? 1,
          path: mountPath,
          middleware: middlewareArgs.flatMap((arg: any) =>
            extractMiddlewareNamesFromNode(arg),
          ),
          routerKey: targetKey,
        });
      }
    }
  }

  // Now find route registrations for each router
  for (const router of routers) {
    if (router.filePath !== file.filePath) continue;

    // Pre-scan: extract chain routes (router.route().get().put().delete()).
    // AST nesting makes this pattern difficult to parse, so scan the full chain text.
    const text = file.content;
    const fileLines = text.split("\n");
    for (let ln = 0; ln < fileLines.length; ln++) {
      const trimmed = fileLines[ln].trim();
      const pathMatch = trimmed.match(new RegExp("^" + escapeRx(router.name) + "\\.route\\s*\\(\\s*([\\x27\\x22\\x60])([^\\x27\\x22\\x60\\s]+)\\1"));
      if (!pathMatch) continue;

      const routePath = pathMatch[2];
      const chainLines = [trimmed];
      let methodLine = ln + 1;
      while (methodLine < fileLines.length && !chainLines.join(" ").includes(";")) {
        const methodTrimmed = fileLines[methodLine].trim();
        if (methodTrimmed === "") break;
        if (!methodTrimmed.startsWith(".")) break;
        chainLines.push(methodTrimmed);
        methodLine++;
      }

      const chainText = chainLines.join(" ");
      const methodPattern = /\.(get|post|put|patch|delete|head|options)\s*\(([^)]*)\)/g;
      for (const methodMatch of chainText.matchAll(methodPattern)) {
        const method = methodMatch[1];
        const argsText = methodMatch[2].trim();
        const parts = splitTopLevel(argsText, ",").map((s) => s.trim()).filter(Boolean);
        let handler = "anonymous";
        const middleware: string[] = [];
        if (parts.length > 0) {
          const hMatch = parts[parts.length - 1].match(/([a-zA-Z_$]\w*)/);
          if (hMatch) handler = hMatch[1];
          for (let i = 0; i < parts.length - 1; i++) {
            middleware.push(...extractMiddlewareNamesFromText(parts[i]));
          }
        }
        router.routes.push({
          filePath: file.filePath,
          line: ln + 1,
          method: method as HttpMethod,
          path: routePath,
          middleware,
          handler,
        });
      }
    }

    // AST scan: direct router.get('/', handler), app.post('/', handler)
    for (const node of walkAst(file.ast)) {
      if (node.type !== "CallExpression") continue;

      const callee = node.callee;
      const objName = getTargetName(callee?.object);
      const propName = getPropertyName(callee?.property);

      // Skip nodes that are part of a chain (callee.object is a CallExpression)
      if (callee?.object?.type === "CallExpression") continue;

      if (objName === router.name && propName && httpMethods.includes(propName as HttpMethod)) {
        const args = node.arguments ?? [];
        const routePath = args.length > 0 ? getStringValue(args[0]) ?? "/" : "/";
        const handlerExpr = args.at(-1);
        const handler = getTargetName(handlerExpr) ?? "anonymous";

        const middleware = args
          .slice(1, -1)
          .flatMap((arg: any) => extractMiddlewareNamesFromNode(arg));

        router.routes.push({
          filePath: file.filePath,
          line: getLoc(node).line ?? 1,
          method: propName as HttpMethod,
          path: routePath,
          middleware,
          handler,
        });
      }
    }
  }

  return routers;
}

const defaultStatusByMethod: Record<HttpMethod, string> = {
  get: "200", post: "201", put: "200", patch: "200",
  delete: "204", head: "200", options: "200",
};

// ─── Helper functions ──────────────────────────────────────────

interface FunctionRecord {
  name: string;
  filePath: string;
  line: number;
  params: string[];
  body: string;
}

function parseFunctionsAst(file: ExpressFile): Map<string, FunctionRecord> {
  const functions = new Map<string, FunctionRecord>();

  for (const node of walkAst(file.ast)) {
    if (
      node.type !== "FunctionDeclaration" &&
      node.type !== "ArrowFunctionExpression" &&
      node.type !== "FunctionExpression"
    ) continue;

    if (!node.id && node.type !== "FunctionDeclaration") continue;

    const name = node.type === "FunctionDeclaration"
      ? node.id?.name
      : null;

    if (!name) continue;

    const bodyRange = node.body?.range;
    let body = "";
    if (bodyRange && file.content) {
      // Body range includes `{}` — strip them
      body = file.content.slice(bodyRange[0] + 1, bodyRange[1] - 1).trim();
    }

    functions.set(name, {
      name,
      filePath: file.filePath,
      line: getLoc(node).line ?? 1,
      params: (node.params ?? []).map(extractParamName).filter(Boolean),
      body,
    });
  }

  // Also capture const foo = (req, res) => {} and const foo = function(req, res) {}
  for (const node of walkAst(file.ast)) {
    if (node.type === "VariableDeclarator") {
      const init = node.init;
      if (
        (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression")
      ) {
        if (node.id?.type === "Identifier") {
          const name = node.id.name;

          const bodyRange = init.body?.range;
          let body = "";
          if (bodyRange && file.content) {
            body = file.content.slice(bodyRange[0] + (init.body.type === "BlockStatement" ? 1 : 0), bodyRange[1] - (init.body.type === "BlockStatement" ? 1 : 0)).trim();
          }

          functions.set(name, {
            name,
            filePath: file.filePath,
            line: getLoc(node).line ?? 1,
            params: (init.params ?? []).map(extractParamName).filter(Boolean),
            body,
          });
        }
      }
    }
  }

  for (const node of walkAst(file.ast)) {
    if (node.type !== "AssignmentExpression") {
      continue;
    }

    const left = node.left;
    const right = node.right;
    if (
      !left ||
      left.type !== "MemberExpression" ||
      (right?.type !== "ArrowFunctionExpression" &&
        right?.type !== "FunctionExpression")
    ) {
      continue;
    }

    const owner = getTargetName(left.object);
    const name = getPropertyName(left.property);
    if (
      !name ||
      (owner !== "exports" && owner !== "module.exports")
    ) {
      continue;
    }

    const bodyRange = right.body?.range;
    let body = "";
    if (bodyRange && file.content) {
      body = file.content
        .slice(
          bodyRange[0] + (right.body.type === "BlockStatement" ? 1 : 0),
          bodyRange[1] - (right.body.type === "BlockStatement" ? 1 : 0),
        )
        .trim();
    }

    functions.set(name, {
      name,
      filePath: file.filePath,
      line: getLoc(node).line ?? 1,
      params: (right.params ?? []).map(extractParamName).filter(Boolean),
      body,
    });
  }

  return functions;
}

function resolveRouterReference(
  node: any,
  filePath: string,
  routers: RouterRecord[],
  fileImports: Map<string, ImportBinding>,
  fileMap: Map<string, ExpressFile>,
  exportsMap: Map<string, FileExports>,
): string | null {
  const requireMember = getInlineRequireMember(node);
  if (requireMember) {
    const sourceFile = resolveRequiredSourceFile(
      filePath,
      requireMember.source,
      fileMap,
    );
    if (sourceFile) {
      const resolved = resolveModuleMemberRouter(
        sourceFile,
        requireMember.member,
        fileMap,
        exportsMap,
      );
      const routerKey = resolved
        ? routerKeyForResolvedExport(resolved, fileMap)
        : null;
      if (routerKey) {
        return routerKey;
      }
    }
  }

  const requireSource = getInlineRequireSource(node);
  if (requireSource) {
    const sourceFile = resolveRequiredSourceFile(filePath, requireSource, fileMap);
    if (sourceFile) {
      const resolved = resolveExportedSymbol(
        sourceFile,
        "default",
        exportsMap,
      );
      const routerKey = resolved
        ? routerKeyForResolvedExport(resolved, fileMap)
        : null;
      if (routerKey) {
        return routerKey;
      }
    }
  }

  const targetName = getTargetName(node);
  if (!targetName) {
    return null;
  }

  const importedMemberMatch = targetName.match(
    /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/,
  );
  if (importedMemberMatch?.[1] && importedMemberMatch[2]) {
    const binding = fileImports.get(importedMemberMatch[1]);
    if (
      (binding?.kind === "namespace" || binding?.kind === "default") &&
      binding.sourceFile
    ) {
      const resolved = binding.kind === "default"
        ? resolveModuleMemberRouter(
            binding.sourceFile,
            importedMemberMatch[2],
            fileMap,
            exportsMap,
          )
        : resolveExportedSymbol(
            binding.sourceFile,
            importedMemberMatch[2],
            exportsMap,
          ) ?? {
            sourceFile: binding.sourceFile,
            localName: importedMemberMatch[2],
          };
      if (resolved) {
        const routerKey = routerKeyForResolvedExport(resolved, fileMap);
        if (routerKey) {
          return routerKey;
        }
      }
    }
  }

  const localRouter = routers.find(
    (router) => router.filePath === filePath && router.name === targetName,
  );
  if (localRouter) {
    return localRouter.key;
  }

  const importBinding = fileImports.get(targetName);
  if (!importBinding?.sourceFile) {
    return null;
  }

  const resolved = importBinding.kind === "default"
    ? resolveExportedSymbol(importBinding.sourceFile, "default", exportsMap)
    : resolveExportedSymbol(
        importBinding.sourceFile,
        importBinding.importedName ?? targetName,
        exportsMap,
      );

  return resolved ? routerKeyForResolvedExport(resolved, fileMap) : null;
}

interface ResolvedExport {
  sourceFile: string;
  localName: string;
}

function resolveExportedSymbol(
  sourceFile: string,
  exportedName: string,
  exportsMap: Map<string, FileExports>,
  seen = new Set<string>(),
): ResolvedExport | null {
  const key = `${sourceFile}#${exportedName}`;
  if (seen.has(key)) {
    return null;
  }
  seen.add(key);

  const sourceExports = exportsMap.get(sourceFile);
  if (!sourceExports) {
    return null;
  }

  if (exportedName === "default" && sourceExports.defaultExpression) {
    return { sourceFile, localName: sourceExports.defaultExpression };
  }

  const localName = sourceExports.named.get(exportedName);
  if (localName) {
    return { sourceFile, localName };
  }

  const reExport = sourceExports.reExports.get(exportedName);
  if (reExport) {
    return resolveExportedSymbol(
      reExport.sourceFile,
      reExport.importedName,
      exportsMap,
      seen,
    ) ?? { sourceFile: reExport.sourceFile, localName: reExport.importedName };
  }

  for (const allSourceFile of sourceExports.allReExports) {
    const resolved = resolveExportedSymbol(
      allSourceFile,
      exportedName,
      exportsMap,
      seen,
    );
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveModuleMemberRouter(
  sourceFile: string,
  memberName: string,
  fileMap: Map<string, ExpressFile>,
  exportsMap: Map<string, FileExports>,
): ResolvedExport | null {
  const sourceExports = exportsMap.get(sourceFile);
  const defaultObjectMember = sourceExports?.defaultObject.get(memberName);
  if (defaultObjectMember) {
    return { sourceFile, localName: defaultObjectMember };
  }

  return resolveExportedSymbol(sourceFile, memberName, exportsMap);
}

function routerKeyForResolvedExport(
  resolved: ResolvedExport,
  fileMap: Map<string, ExpressFile>,
): string | null {
  const targetFile = fileMap.get(resolved.sourceFile);
  if (!targetFile || !declaresRouterSymbol(targetFile, resolved.localName)) {
    return null;
  }

  return `${resolved.sourceFile}#${resolved.localName}`;
}

function getInlineRequireSource(node: any): string | null {
  if (
    node?.type !== "CallExpression" ||
    node.callee?.type !== "Identifier" ||
    node.callee.name !== "require"
  ) {
    return null;
  }

  return getStringValue(node.arguments?.[0]);
}

function getInlineRequireMember(node: any): { source: string; member: string } | null {
  if (node?.type !== "MemberExpression") {
    return null;
  }

  const source = getInlineRequireSource(node.object);
  const member = getPropertyName(node.property);
  return source && member ? { source, member } : null;
}

function resolveRequiredSourceFile(
  filePath: string,
  source: string,
  fileMap: Map<string, ExpressFile>,
): string | null {
  if (!source.startsWith(".")) {
    return null;
  }

  return resolveLocalModulePath(filePath, source, new Set(fileMap.keys()));
}

function parseObjectExportMap(objectExpression: any): Array<[string, string]> {
  const results: Array<[string, string]> = [];

  for (const property of objectExpression.properties ?? []) {
    if (!property || property.type === "SpreadElement") {
      continue;
    }

    const exportedName = getPropertyName(property.key);
    const localName = getTargetName(property.value) ?? exportedName;
    if (exportedName && localName) {
      results.push([exportedName, localName]);
    }
  }

  return results;
}

// ─── Module resolution ─────────────────────────────────────────

function resolveLocalModulePath(
  fromFile: string,
  moduleName: string,
  knownFiles: Set<string>,
): string | null {
  const dir = path.dirname(fromFile);
  const candidates = [
    path.resolve(dir, moduleName),
    path.resolve(dir, moduleName) + ".ts",
    path.resolve(dir, moduleName) + ".js",
    path.resolve(dir, moduleName, "index.ts"),
    path.resolve(dir, moduleName, "index.js"),
  ];
  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

function declaresRouterSymbol(file: ExpressFile, symbolName: string): boolean {
  for (const node of walkAst(file.ast)) {
    if (node.type !== "VariableDeclarator") {
      continue;
    }

    if (node.id?.type !== "Identifier" || node.id.name !== symbolName) {
      continue;
    }

    if (isExpressRouterCall(node.init)) {
      return true;
    }
  }

  return false;
}

function isExpressAppCall(node: any): boolean {
  if (!node || node.type !== "CallExpression") {
    return false;
  }

  const callee = node.callee;
  return callee?.type === "Identifier" && callee.name === "express";
}

function isExpressRouterCall(node: any): boolean {
  if (!node || node.type !== "CallExpression") {
    return false;
  }

  const callee = node.callee;
  if (callee?.type === "Identifier") {
    return callee.name === "Router";
  }

  if (callee?.type === "MemberExpression") {
    return (
      getTargetName(callee.object) === "express" &&
      getPropertyName(callee.property) === "Router"
    );
  }

  return false;
}

// ─── AST walking ───────────────────────────────────────────────

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function* walkAst(node: any, depth = 0): Generator<any> {
  if (!node || typeof node !== "object") return;

  yield node;

  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        yield* walkAst(item, depth + 1);
      }
    } else if (typeof child === "object" && child !== null) {
      yield* walkAst(child, depth + 1);
    }
  }
}

// ─── Utility functions ─────────────────────────────────────────

function getTargetName(node: any): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = getTargetName(node.object);
    const prop = getPropertyName(node.property);
    return obj && prop ? `${obj}.${prop}` : obj;
  }
  if (node.type === "CallExpression") return getTargetName(node.callee);
  return null;
}

function extractParamName(node: any): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "AssignmentPattern") return extractParamName(node.left);
  if (node.type === "ObjectPattern" || node.type === "ArrayPattern") return null;
  return null;
}

function getAccessPath(node: any): { base: string; property: string } | null {
  if (!node) return null;
  if (node.type === "MemberExpression") {
    const base = getTargetName(node.object);
    const prop = getPropertyName(node.property);
    if (base && prop) return { base, property: prop };
  }
  return null;
}

function extractMiddlewareNamesFromNode(node: any): string[] {
  if (!node) {
    return [];
  }

  if (node.type === "ArrayExpression") {
    return (node.elements ?? []).flatMap((element: any) =>
      extractMiddlewareNamesFromNode(element),
    );
  }

  if (node.type === "SpreadElement") {
    return extractMiddlewareNamesFromNode(node.argument);
  }

  const name = getTargetName(node);
  return name ? [name] : [];
}

function extractMiddlewareNamesFromText(expression: string): string[] {
  const trimmed = expression.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitTopLevel(trimmed.slice(1, -1), ",")
      .flatMap(extractMiddlewareNamesFromText);
  }

  const match = trimmed.match(/([a-zA-Z_$]\w*)/);
  return match?.[1] ? [match[1]] : [];
}

function inferTag(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "default";
}

function capitalize(s: string): string {
  return s ? `${s[0].toUpperCase()}${s.slice(1)}` : s;
}

function buildOperationId(method: string, path: string, handlerName: string): string {
  const handlerPart = handlerName
    .replace(/[^a-zA-Z0-9.]/g, "")
    .replace(/\./g, "");

  if (handlerPart && handlerPart !== "inlineHandler") {
    return handlerPart;
  }

  const pathSuffix = path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9]+/g, " "))
    .map((part) => part.split(" ").filter(Boolean).map(capitalize).join(""))
    .join("");
  return `${method}${pathSuffix || "Root"}`;
}

function buildSummary(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function normalizePath(p: string): string {
  return (
    "/" +
    p
      .replace(/^\/+|\/+$/g, "")
      .replace(/\/+/g, "/")
      .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
      .replace(/\*([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
  );
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

// ─── Main export ───────────────────────────────────────────────

/**
 * Scan an Express.js project using AST-based parsing.
 * Detects framework automatically, resolves imports/exports, traces routes,
 * and analyzes handlers for request/response patterns.
 */
export async function scanExpressProjectAst(
  root: string,
  projectName: string,
  projectVersion: string,
  config: BrunogenConfig,
): Promise<NormalizedProject> {
  const files = await loadExpressAstFiles(root);
  if (files.length === 0) {
    throw new Error(
      `No parsable Express.js files found under ${root}. ` +
      "Ensure .js/.ts/.mjs/.cjs files exist and are valid JavaScript/TypeScript."
    );
  }

  const fileMap = new Map(files.map((f) => [f.filePath, f]));
  const filePaths = new Set(fileMap.keys());
  const imports = new Map<string, Map<string, ImportBinding>>();
  const exportsMap = new Map<string, FileExports>();
  const functions = new Map<string, FunctionRecord>();
  const regexIndex = await buildExpressProjectIndex(root);

  for (const file of files) {
    imports.set(file.filePath, parseImportsAst(file, filePaths));
    exportsMap.set(file.filePath, parseExportsAst(file, filePaths));

    for (const [name, fn] of parseFunctionsAst(file)) {
      functions.set(name, fn);
    }
  }

  // Discover routers
  const routers: RouterRecord[] = [];
  for (const file of files) {
    const fileRouters = parseRoutersAst(file, fileMap, imports, exportsMap);
    routers.push(...fileRouters);
  }

  // Deduplicate and resolve mounts
  const routerByKey = new Map<string, RouterRecord>();
  for (const router of routers) {
    const existing = routerByKey.get(router.key);
    if (!existing) {
      routerByKey.set(router.key, router);
    } else {
      // Merge routes
      existing.routes.push(...router.routes);
      existing.mounts.push(...router.mounts);
    }
  }

  // Find root routers (apps and routers not mounted by others)
  const mountedKeys = new Set<string>();
  for (const router of routerByKey.values()) {
    for (const mount of router.mounts) {
      mountedKeys.add(mount.routerKey);
    }
  }

  const rootRouters = [...routerByKey.values()].filter(
    (r) => r.kind === "app" || !mountedKeys.has(r.key),
  );

  const endpoints: NormalizedEndpoint[] = [];
  const warnings: GenerationWarning[] = [];
  const seenEndpoints = new Set<string>();

  // Collect endpoints from root routers, following mounts
  for (const router of rootRouters) {
    collectRouterEndpointsAst({
      router,
      allRouters: routerByKey,
      functions,
      regexIndex,
      config,
      prefix: "",
      inheritedMiddleware: [],
      visited: new Set(),
      endpoints,
      warnings,
      seenEndpoints,
    });
  }

  return {
    framework: "express" as any,
    projectName,
    projectVersion,
    endpoints,
    warnings,
  };
}

interface CollectContext {
  router: RouterRecord;
  allRouters: Map<string, RouterRecord>;
  functions: Map<string, FunctionRecord>;
  regexIndex: ExpressProjectIndex;
  config: BrunogenConfig;
  prefix: string;
  inheritedMiddleware: string[];
  visited: Set<string>;
  endpoints: NormalizedEndpoint[];
  warnings: GenerationWarning[];
  seenEndpoints: Set<string>;
}

function collectRouterEndpointsAst(ctx: CollectContext): void {
  if (ctx.visited.has(ctx.router.key)) return;
  const visited = new Set(ctx.visited);
  visited.add(ctx.router.key);

  const fullMiddleware = [...ctx.inheritedMiddleware, ...(ctx.router.middleware ?? [])];

  // Process direct routes
  for (const route of ctx.router.routes) {
    const fullPath = joinPath(ctx.prefix, route.path);
    const endpointKey = `${route.method}:${fullPath}`;

    if (ctx.seenEndpoints.has(endpointKey)) continue;
    ctx.seenEndpoints.add(endpointKey);

    const analysis = analyzeExpressHandler(
      route.handler,
      route.filePath,
      ctx.regexIndex,
    );
    const authInference = inferBearerAuthFromMiddleware(
      "Express",
      [...fullMiddleware, ...route.middleware],
      ctx.config.auth.middlewarePatterns.bearer,
    );

    const pathParams = extractPathParams(fullPath);
    const parameters = dedupeParameters([
      ...pathParams,
      ...analysis.queryParameters.filter(
        (p) => p.in !== "path" || !pathParams.some(pp => pp.name === p.name),
      ),
      ...analysis.headerParameters,
    ]);

    const defaultStatus = defaultStatusByMethod[route.method] ?? "200";

    ctx.endpoints.push({
      id: endpointKey,
      method: route.method,
      path: fullPath,
      operationId: buildOperationId(route.method, fullPath, route.handler),
      summary: buildSummary(route.method, fullPath),
      tags: [inferTag(fullPath)],
      parameters,
      requestBody: analysis.requestBody,
      responses: analysis.responses.length > 0 ? analysis.responses : [{
        statusCode: defaultStatus,
        description: "Inferred response",
        contentType: "application/json",
      }],
      auth: authInference.auth,
      source: { file: route.filePath, line: route.line },
      warnings: [...analysis.warnings, ...authInference.warnings],
    });

    ctx.warnings.push(...analysis.warnings, ...authInference.warnings);
  }

  // Follow mounts
  for (const mount of ctx.router.mounts) {
    const mountPrefix = joinPath(ctx.prefix, mount.path);
    const mountKey = mount.routerKey;
    const mountedRouter = ctx.allRouters.get(mountKey);

    if (mountedRouter) {
      collectRouterEndpointsAst({
        ...ctx,
        router: mountedRouter,
        prefix: mountPrefix,
        inheritedMiddleware: [...fullMiddleware, ...mount.middleware],
        visited,
      });
    }
  }
}

function extractPathParams(routePath: string): NormalizedParameter[] {
  const params: NormalizedParameter[] = [];
  for (const match of routePath.matchAll(/\{([^}]+)\}|:([^/]+)/g)) {
    params.push({
      name: match[1] ?? match[2],
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }
  return params;
}
