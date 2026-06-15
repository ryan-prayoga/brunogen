import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { defaultConfig } from "../src/core/config";
import { fileExists } from "../src/core/fs";
import { generateArtifacts, resolveOutputFormats, writeArtifacts } from "../src/core/pipeline";
import { fixturePath } from "./helpers";

describe("AI and MCP outputs", () => {
  it("writes AI context and MCP server artifacts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "brunogen-ai-"));
    const config = defaultConfig();
    config.output.openapiFile = "out/openapi.yaml";
    config.output.brunoDir = "out/bruno";
    config.output.aiDir = "out/ai";
    config.output.mcpDir = "out/mcp";

    const artifacts = await generateArtifacts(fixturePath("laravel"), config);
    await writeArtifacts(
      artifacts,
      config,
      {
        openApiPath: path.join(workspace, config.output.openapiFile),
        brunoDir: path.join(workspace, config.output.brunoDir),
        aiDir: path.join(workspace, config.output.aiDir),
        mcpDir: path.join(workspace, config.output.mcpDir),
      },
      ["ai", "mcp"],
    );

    const apiContext = await fs.readFile(path.join(workspace, "out/ai/api-context.md"), "utf8");
    const tools = JSON.parse(await fs.readFile(path.join(workspace, "out/ai/tools.json"), "utf8"));
    const findings = JSON.parse(await fs.readFile(path.join(workspace, "out/ai/findings.json"), "utf8"));
    const mcpServer = await fs.readFile(path.join(workspace, "out/mcp/src/server.js"), "utf8");

    expect(await fileExists(path.join(workspace, "out/ai/api-context.md"))).toBe(true);
    expect(await fileExists(path.join(workspace, "out/ai/tools.json"))).toBe(true);
    expect(await fileExists(path.join(workspace, "out/ai/findings.json"))).toBe(true);
    expect(await fileExists(path.join(workspace, "out/mcp/package.json"))).toBe(true);
    expect(apiContext).toContain("## Endpoints");
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(findings.findings.length).toBeGreaterThan(0);
    expect(mcpServer).toContain("@modelcontextprotocol/sdk/server/mcp.js");
    expect(mcpServer).toContain("TOOL_DEFINITIONS");
  });

  it("resolves CLI output formats", () => {
    const config = defaultConfig();
    config.formats = ["bruno"];

    expect(resolveOutputFormats(config, "all")).toEqual(["bruno", "ai", "mcp"]);
    expect(resolveOutputFormats(config, "ai,mcp")).toEqual(["ai", "mcp"]);
    expect(resolveOutputFormats(config)).toEqual(["bruno"]);
  });
});