import type { NormalizedParameter } from "../../core/model";

export function extractLaravelQueryParameters(
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

export function extractLaravelHeaderParameters(
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
