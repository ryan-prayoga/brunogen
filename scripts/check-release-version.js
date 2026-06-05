const { readFileSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(repoRoot, "package.json"));
const packageLock = require(path.join(repoRoot, "package-lock.json"));
const changelog = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
const tagName = process.argv[2] || process.env.GITHUB_REF_NAME || "";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const version = packageJson.version;
  assert(version, "package.json is missing version.");
  assert(
    packageLock.version === version,
    `package-lock.json version '${packageLock.version}' does not match package.json version '${version}'.`,
  );
  assert(
    packageLock.packages?.[""]?.version === version,
    `package-lock root package version '${packageLock.packages?.[""]?.version}' does not match package.json version '${version}'.`,
  );
  assert(
    changelog.includes(`## v${version}`),
    `CHANGELOG.md is missing a section for v${version}.`,
  );

  if (tagName) {
    assert(
      tagName === `v${version}`,
      `Release tag '${tagName}' does not match package version v${version}.`,
    );
  }

  console.log(`Release version check passed for v${version}.`);
}

main();
