import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanExpressProjectAst } from "../src/adapters/express-ast";
import { defaultConfig } from "../src/core/config";
import { fixturePath } from "./helpers";

describe("Express AST adapter", () => {
  it("detects nested routes, auth hints, and helper responses", async () => {
    const project = await scanExpressProjectAst(
      fixturePath("express"),
      "acme/express-demo",
      "0.0.0",
      defaultConfig(),
    );

    const createUser = project.endpoints.find(
      (endpoint) =>
        endpoint.path === "/api/v1/users" && endpoint.method === "post",
    );
    expect(createUser?.auth.type).toBe("bearer");
    expect(createUser?.requestBody?.schema.properties?.name?.type).toBe(
      "string",
    );
    expect(createUser?.requestBody?.schema.properties?.email?.format).toBe(
      "email",
    );
    expect(createUser?.requestBody?.schema.properties?.age?.type).toBe(
      "integer",
    );
    expect(
      createUser?.responses.map((response) => response.statusCode),
    ).toEqual(expect.arrayContaining(["201", "409", "422"]));

    const userPost = project.endpoints.find(
      (endpoint) =>
        endpoint.path === "/api/v1/users/{id}/posts/{postId}" &&
        endpoint.method === "get",
    );
    expect(userPost?.auth.type).toBe("bearer");

    const adminUsers = project.endpoints.find(
      (endpoint) =>
        endpoint.path === "/api/admin/users" && endpoint.method === "get",
    );
    expect(adminUsers?.responses).toContainEqual(
      expect.objectContaining({ statusCode: "200" }),
    );
  });

  it("surfaces unknown auth middleware warnings for custom Express auth", async () => {
    const project = await scanExpressProjectAst(
      fixturePath("express-custom-auth"),
      "acme/express-custom-auth",
      "0.0.0",
      defaultConfig(),
    );

    const reports = project.endpoints.find(
      (endpoint) => endpoint.path === "/api/reports" && endpoint.method === "get",
    );

    expect(reports?.auth.type).toBe("none");
    expect(project.warnings).toContainEqual(
      expect.objectContaining({
        code: "EXPRESS_AUTH_MIDDLEWARE_UNKNOWN",
        message: expect.stringContaining("checkPermission"),
      }),
    );
  });

  it("infers inline Joi-backed request schemas", async () => {
    const project = await scanExpressProjectAst(
      fixturePath("express-joi-inline"),
      "acme/express-joi-inline",
      "0.0.0",
      defaultConfig(),
    );

    const searchCatalog = project.endpoints.find(
      (endpoint) =>
        endpoint.path === "/api/catalog/search" && endpoint.method === "post",
    );

    expect(searchCatalog?.requestBody?.schema.properties?.page?.type).toBe(
      "integer",
    );
    expect(searchCatalog?.requestBody?.schema.properties?.page?.minimum).toBe(1);
    expect(searchCatalog?.requestBody?.schema.properties?.filters?.type).toBe(
      "object",
    );
    expect(
      searchCatalog?.requestBody?.schema.properties?.filters?.properties?.status
        ?.enum,
    ).toEqual(["draft", "published"]);
    expect(
      searchCatalog?.responses.map((response) => response.statusCode),
    ).toEqual(expect.arrayContaining(["200", "422"]));
  });

  it("matches absolute-root output when scanning a relative project root", async () => {
    const config = defaultConfig();
    const absoluteRoot = fixturePath("express");
    const relativeRoot = path.relative(process.cwd(), absoluteRoot);

    const [absoluteProject, relativeProject] = await Promise.all([
      scanExpressProjectAst(
        absoluteRoot,
        "acme/express-demo",
        "0.0.0",
        config,
      ),
      scanExpressProjectAst(
        relativeRoot,
        "acme/express-demo",
        "0.0.0",
        config,
      ),
    ]);

    const summarize = (project: typeof absoluteProject) =>
      project.endpoints.map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        operationId: endpoint.operationId,
      }));

    expect(summarize(relativeProject)).toEqual(summarize(absoluteProject));
  });
});
