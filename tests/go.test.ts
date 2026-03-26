import { describe, expect, it } from "vitest";

import { defaultConfig } from "../src/core/config";
import { generateArtifacts } from "../src/core/pipeline";
import { fixturePath } from "./helpers";

describe("Go adapters", () => {
  it("detects Gin routes, nested groups, and struct-based request schemas", async () => {
    const artifacts = await generateArtifacts(fixturePath("gin"), defaultConfig());
    expect(artifacts.normalized.framework).toBe("gin");
    expect(artifacts.normalized.endpoints.length).toBeGreaterThanOrEqual(8);

    const createUser = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/users" && endpoint.method === "post");
    expect(createUser?.auth.type).toBe("bearer");
    expect(createUser?.requestBody?.schema.properties?.name?.type).toBe("string");
    expect(createUser?.requestBody?.schema.properties?.email?.format).toBe("email");
    expect(createUser?.requestBody?.schema.properties?.age?.minimum).toBe(18);
    expect(createUser?.requestBody?.schema.properties?.role?.enum).toEqual(["user", "admin"]);
    expect(createUser?.requestBody?.schema.required).toContain("name");
    expect(createUser?.responses.map((response) => response.statusCode)).toEqual(expect.arrayContaining(["201", "400", "409"]));
    expect(createUser?.responses).toContainEqual(expect.objectContaining({
      statusCode: "201",
      example: expect.objectContaining({
        message: "user created",
        data: expect.objectContaining({
          name: "Jane Doe",
          email: "user@example.com",
        }),
      }),
    }));

    const listUsers = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/users" && endpoint.method === "get");
    expect(listUsers?.parameters).toContainEqual(expect.objectContaining({
      name: "page",
      in: "query",
      schema: expect.objectContaining({ type: "integer" }),
    }));

    const showUser = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/users/{id}" && endpoint.method === "get");
    expect(showUser?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "id", in: "path" }),
      expect.objectContaining({ name: "X-Trace-Id", in: "header" }),
    ]));
    expect(showUser?.responses.map((response) => response.statusCode)).toEqual(expect.arrayContaining(["200", "404"]));

    const login = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/auth/login" && endpoint.method === "post");
    expect(login?.auth.type).toBe("none");
  });

  it("detects Fiber body, query, header, and status-chain responses", async () => {
    const artifacts = await generateArtifacts(fixturePath("fiber"), defaultConfig());
    expect(artifacts.normalized.framework).toBe("fiber");
    expect(artifacts.normalized.endpoints.length).toBeGreaterThanOrEqual(4);

    const createWidget = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/widgets" && endpoint.method === "post");
    expect(createWidget?.auth.type).toBe("bearer");
    expect(createWidget?.requestBody?.schema.properties?.name?.type).toBe("string");
    expect(createWidget?.parameters).toContainEqual(expect.objectContaining({
      name: "page",
      in: "query",
      schema: expect.objectContaining({ type: "integer" }),
    }));
    expect(createWidget?.parameters).toContainEqual(expect.objectContaining({
      name: "TTOKEN",
      in: "header",
    }));
    expect(createWidget?.responses).toContainEqual(expect.objectContaining({
      statusCode: "201",
      example: expect.objectContaining({
        message: "widget created",
      }),
    }));

    const deleteWidget = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/widgets/{id}" && endpoint.method === "delete");
    expect(deleteWidget?.responses).toContainEqual(expect.objectContaining({
      statusCode: "204",
    }));
  });

  it("detects Echo routes, bind schemas, and auth-protected groups", async () => {
    const artifacts = await generateArtifacts(fixturePath("echo"), defaultConfig());
    expect(artifacts.normalized.framework).toBe("echo");
    expect(artifacts.normalized.endpoints.length).toBeGreaterThanOrEqual(4);

    const createOrder = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/orders" && endpoint.method === "post");
    expect(createOrder?.auth.type).toBe("bearer");
    expect(createOrder?.requestBody?.schema.properties?.customer_id?.type).toBe("string");
    expect(createOrder?.requestBody?.schema.properties?.total?.minimum).toBe(1);
    expect(createOrder?.requestBody?.schema.required).toContain("customer_id");
    expect(createOrder?.parameters).toContainEqual(expect.objectContaining({
      name: "TTOKEN",
      in: "header",
    }));
    expect(createOrder?.responses).toContainEqual(expect.objectContaining({
      statusCode: "201",
      example: expect.objectContaining({
        total: 1,
        customerID: "customer_123",
        token: "TTOKEN_VALUE",
      }),
    }));

    const updateOrder = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/orders/{id}" && endpoint.method === "put");
    expect(updateOrder?.responses).toContainEqual(expect.objectContaining({
      statusCode: "422",
    }));

    const deleteOrder = artifacts.normalized.endpoints.find((endpoint) => endpoint.path === "/api/orders/{id}" && endpoint.method === "delete");
    expect(deleteOrder?.responses).toContainEqual(expect.objectContaining({
      statusCode: "204",
    }));
  });
});
