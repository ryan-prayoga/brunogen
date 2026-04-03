/**
 * Shared AST-based parsing types and interfaces.
 * Used by framework-specific AST adapters (express-ast, laravel-ast, go-ast).
 */

import type {
  HttpMethod,
  NormalizedParameter,
  NormalizedRequestBody,
  NormalizedResponse,
  NormalizedAuth,
  GenerationWarning,
  SourceLocation,
} from "./model";

export interface RequestAccessPattern {
  source: string;
  name: string;
  location: "body" | "query" | "header" | "param" | "cookie";
  required: boolean;
  inferredType?: string;
  defaultValue?: unknown;
}

export interface ResponseReturnPattern {
  statusCode?: string;
  contentType?: string;
  bodyLiteral?: string;
  bodyExpression?: string;
  usesHelper?: string;
  sourceLocation?: SourceLocation;
}

export interface ASTHandlerInfo {
  name: string;
  filePath: string;
  requestAccesses: RequestAccessPattern[];
  responseReturns: ResponseReturnPattern[];
  warnings: GenerationWarning[];
}

export interface ASTRouteInfo {
  method: HttpMethod;
  path: string;
  handlerRef: string;
  middleware: string[];
  source: SourceLocation;
  routeChain?: string;
}

export interface ASTGroupContext {
  prefix: string;
  middleware: string[];
  controller?: string;
}

export type ASTParseResult = {
  routes: ASTRouteInfo[];
  handlers: Map<string, ASTHandlerInfo>;
  warnings: GenerationWarning[];
};
