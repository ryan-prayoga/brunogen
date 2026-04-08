const { execFileSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const maxUnpackedSizeBytes = 1_000_000;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function readPackStats() {
  const raw = execFileSync(
    npmCommand,
    ["pack", "--json", "--dry-run", "--ignore-scripts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_ignore_scripts: "true",
      },
    },
  );

  const match = raw.match(/\[\s*\{[\s\S]*\}\s*\]\s*$/);
  if (!match) {
    throw new Error(`Could not parse npm pack output:\n${raw}`);
  }

  const [packResult] = JSON.parse(match[0]);
  return packResult;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  const packResult = readPackStats();

  if (packResult.unpackedSize > maxUnpackedSizeBytes) {
    throw new Error(
      `npm package unpacked size ${formatBytes(packResult.unpackedSize)} exceeds ${formatBytes(maxUnpackedSizeBytes)}.`
    );
  }

  console.log(
    `npm package unpacked size ${formatBytes(packResult.unpackedSize)} within limit ${formatBytes(maxUnpackedSizeBytes)}.`
  );
}

main();
