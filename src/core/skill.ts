import path from "node:path";
import { accessSync, promises as fs } from "node:fs";
import os from "node:os";

import { ensureDirectory, fileExists } from "./fs";

export type SkillInstallTarget = "grok-user" | "grok-project";

export interface SkillInstallResult {
  sourceDir: string;
  targetDir: string;
  target: SkillInstallTarget;
}

export function resolveBundledSkillDir(startDir: string): string {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, "skills", "brunogen-api");
    if (fileExistsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error("Bundled brunogen-api skill not found. Reinstall brunogen or run from the repository checkout.");
}

export async function installBundledSkill(input: {
  startDir: string;
  target: SkillInstallTarget;
  projectRoot?: string;
  force?: boolean;
}): Promise<SkillInstallResult> {
  const sourceDir = resolveBundledSkillDir(input.startDir);
  const targetDir = input.target === "grok-project"
    ? path.resolve(input.projectRoot ?? process.cwd(), ".grok", "skills", "brunogen-api")
    : path.join(os.homedir(), ".grok", "skills", "brunogen-api");

  if (await fileExists(targetDir) && !input.force) {
    throw new Error(
      `Skill already exists at ${targetDir}. Re-run with --force to overwrite it.`,
    );
  }

  await ensureDirectory(path.dirname(targetDir));
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyDirectory(sourceDir, targetDir);

  return {
    sourceDir,
    targetDir,
    target: input.target,
  };
}

async function copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await ensureDirectory(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

function fileExistsSync(filePath: string): boolean {
  try {
    accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}