const { execFileSync, spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, rmSync, cpSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const nodeCommand = process.execPath;
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "laravel");

function runCli(args, cwd) {
  return execFileSync(nodeCommand, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliFailure(args, cwd) {
  return spawnSync(nodeCommand, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(existsSync(cliPath), `CLI build not found at ${cliPath}. Run npm run build first.`);

  const workspace = mkdtempSync(path.join(os.tmpdir(), "brunogen-cli-e2e-"));
  const projectRoot = path.join(workspace, "laravel");

  try {
    cpSync(fixtureRoot, projectRoot, {
      recursive: true,
      filter: (source) => !path.relative(fixtureRoot, source).split(path.sep).includes(".brunogen"),
    });

    const initOutput = runCli(["init"], projectRoot);
    assert(initOutput.includes("Created"), "init did not report config creation.");
    assert(
      existsSync(path.join(projectRoot, "brunogen.config.json")),
      "init did not create brunogen.config.json.",
    );

    const generateOutput = runCli(["generate"], projectRoot);
    assert(
      generateOutput.includes("Generated 6 endpoints."),
      "generate did not scan the expected Laravel endpoints.",
    );
    assert(
      existsSync(path.join(projectRoot, ".brunogen", "openapi.yaml")),
      "generate did not write .brunogen/openapi.yaml.",
    );
    assert(
      existsSync(path.join(projectRoot, ".brunogen", "bruno", "bruno.json")),
      "generate did not write the Bruno collection manifest.",
    );
    assert(
      existsSync(path.join(projectRoot, ".brunogen", "ai", "api-context.md")),
      "generate did not write AI context output.",
    );
    assert(
      existsSync(path.join(projectRoot, ".brunogen", "mcp", "src", "server.js")),
      "generate did not write MCP server output.",
    );

    const validateOutput = runCli(["validate"], projectRoot);
    assert(
      validateOutput.includes("OpenAPI valid. 6 endpoints scanned."),
      "validate did not report valid OpenAPI.",
    );

    const doctorOutput = runCli(["doctor"], projectRoot);
    assert(doctorOutput.includes("framework: laravel"), "doctor did not detect Laravel.");
    assert(doctorOutput.includes("endpoints scanned: 6"), "doctor did not report the expected endpoint count.");

    const invalidConfigRoot = path.join(workspace, "invalid-config");
    cpSync(fixtureRoot, invalidConfigRoot, {
      recursive: true,
      filter: (source) => !path.relative(fixtureRoot, source).split(path.sep).includes(".brunogen"),
    });
    writeFileSync(
      path.join(invalidConfigRoot, "brunogen.config.json"),
      "{ invalid json\n",
      "utf8",
    );
    const invalidConfigResult = runCliFailure(["generate"], invalidConfigRoot);
    assert(invalidConfigResult.status === 1, "generate should fail for invalid config JSON.");
    assert(
      invalidConfigResult.stderr.includes("Invalid brunogen config at"),
      "invalid config error should include a friendly config message.",
    );
    assert(
      !invalidConfigResult.stderr.includes("at JSON.parse"),
      "invalid config error should not leak a JSON.parse stack trace.",
    );

    console.log("CLI e2e check passed.");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main();
