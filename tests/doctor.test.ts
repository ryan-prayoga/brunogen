import { describe, expect, it } from "vitest";

import { defaultConfig } from "../src/core/config";
import { runDoctor } from "../src/core/doctor";
import { fixturePath } from "./helpers";

describe("Doctor command", () => {
  it("reports unknown Express auth middleware and configured bearer hints", async () => {
    const result = await runDoctor(fixturePath("express-custom-auth"), defaultConfig());

    expect(result.lines).toContain("configured bearer middleware hints: none");
    expect(result.lines).toContain("express auth middleware warnings: 1");
    expect(result.lines).toContain("express unknown auth middleware: checkPermission");

    const configured = defaultConfig();
    configured.auth.middlewarePatterns.bearer = ["checkPermission"];

    const configuredResult = await runDoctor(fixturePath("express-custom-auth"), configured);
    expect(configuredResult.lines).toContain("configured bearer middleware hints: checkPermission");
    expect(configuredResult.lines).toContain("express auth middleware warnings: 0");
    expect(configuredResult.lines).toContain("express unknown auth middleware: none");
  });

  it("reports unknown Go auth middleware and configured bearer hints", async () => {
    const result = await runDoctor(fixturePath("gin-custom-auth"), defaultConfig());

    expect(result.lines).toContain("configured bearer middleware hints: none");
    expect(result.lines).toContain("go auth middleware warnings: 1");
    expect(result.lines).toContain("go unknown auth middleware: CheckPermission");

    const configured = defaultConfig();
    configured.auth.middlewarePatterns.bearer = ["CheckPermission"];

    const configuredResult = await runDoctor(fixturePath("gin-custom-auth"), configured);
    expect(configuredResult.lines).toContain("configured bearer middleware hints: CheckPermission");
    expect(configuredResult.lines).toContain("go auth middleware warnings: 0");
    expect(configuredResult.lines).toContain("go unknown auth middleware: none");
  });
});
