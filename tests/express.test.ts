import { describe, expect, it } from "vitest";

import { defaultConfig } from "../src/core/config";
import { generateArtifacts } from "../src/core/pipeline";
import { fixturePath } from "./helpers";

describe("Express adapter", () => {
  it("detects Express routes and request schemas", async () => {
    const artifacts = await generateArtifacts(fixturePath("express"), defaultConfig());
    expect(artifacts.normalized.framework).toBe("express");
    expect(artifacts.normalized.projectName).toBe("acme/express-demo");

    const createUser = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/users" && endpoint.method === "post");
    expect(createUser?.auth.type).toBe("bearer");
    expect(createUser?.requestBody?.schema.properties?.name?.type).toBe("string");
    expect(createUser?.requestBody?.schema.required).toEqual(expect.arrayContaining(["name", "email", "age"]));
    expect(createUser?.parameters).toContainEqual(expect.objectContaining({
      name: "page",
      in: "query",
    }));
    expect(createUser?.parameters).toContainEqual(expect.objectContaining({
      name: "X-Trace-Id",
      in: "header",
    }));
    expect(createUser?.responses).toContainEqual(expect.objectContaining({
      statusCode: "201",
    }));

    const showUser = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/users/{id}" && endpoint.method === "get");
    expect(showUser?.parameters).toContainEqual(expect.objectContaining({
      name: "id",
      in: "path",
    }));

    const login = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/sessions" && endpoint.method === "post");
    expect(login?.requestBody?.schema.required).toEqual(expect.arrayContaining(["email", "password"]));
    expect(artifacts.warnings).not.toContainEqual(expect.objectContaining({
      code: "EXPRESS_HANDLER_NOT_FOUND",
    }));
  });
});
