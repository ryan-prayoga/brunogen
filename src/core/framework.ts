import path from "node:path";
import { promises as fs } from "node:fs";

import { fileExists, listFiles, readJsonFile } from "./fs";
import type { GenerationWarning, SupportedFramework } from "./model";

export interface DetectionResult {
  framework: SupportedFramework | null;
  projectName: string;
  warnings: GenerationWarning[];
}

interface ComposerJson {
  name?: string;
  require?: Record<string, string>;
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectFramework(root: string, preferred: SupportedFramework | "auto"): Promise<DetectionResult> {
  if (preferred !== "auto") {
    return {
      framework: preferred,
      projectName: await inferProjectName(root, preferred),
      warnings: [],
    };
  }

  const warnings: GenerationWarning[] = [];

  if (await isLaravelProject(root)) {
    return {
      framework: "laravel",
      projectName: await inferProjectName(root, "laravel"),
      warnings,
    };
  }

  const goFramework = await detectGoFramework(root);
  if (goFramework) {
    return {
      framework: goFramework,
      projectName: await inferProjectName(root, goFramework),
      warnings,
    };
  }

  if (await isExpressProject(root)) {
    return {
      framework: "express",
      projectName: await inferProjectName(root, "express"),
      warnings,
    };
  }

  warnings.push({
    code: "FRAMEWORK_NOT_DETECTED",
    message: "Could not detect a supported framework. Supported targets are Laravel, Gin, Fiber, Echo, and Express.",
  });

  return {
    framework: null,
    projectName: path.basename(root),
    warnings,
  };
}

async function isLaravelProject(root: string): Promise<boolean> {
  const artisanPath = path.join(root, "artisan");
  const routesPath = path.join(root, "routes");
  const composerPath = path.join(root, "composer.json");

  if (await fileExists(artisanPath)) {
    return true;
  }

  if (!(await fileExists(composerPath))) {
    return false;
  }

  try {
    const composer = await readJsonFile<ComposerJson>(composerPath);
    return Boolean(composer.require?.["laravel/framework"]) || await fileExists(routesPath);
  } catch {
    return await fileExists(routesPath);
  }
}

async function detectGoFramework(root: string): Promise<SupportedFramework | null> {
  const goFiles = await listFiles(
    root,
    (filePath) => filePath.endsWith(".go"),
    { ignoreDirectories: ["vendor", "node_modules", ".git", "dist"] },
  );

  let foundGin = false;
  let foundFiber = false;
  let foundEcho = false;

  for (const filePath of goFiles) {
    const content = await fs.readFile(filePath, "utf8");

    if (content.includes("github.com/gin-gonic/gin")) {
      foundGin = true;
    }

    if (content.includes("github.com/gofiber/fiber")) {
      foundFiber = true;
    }

    if (content.includes("github.com/labstack/echo")) {
      foundEcho = true;
    }
  }

  if (foundGin) {
    return "gin";
  }

  if (foundFiber) {
    return "fiber";
  }

  if (foundEcho) {
    return "echo";
  }

  return null;
}

async function isExpressProject(root: string): Promise<boolean> {
  const packageJsonPath = path.join(root, "package.json");

  if (await fileExists(packageJsonPath)) {
    try {
      const packageJson = await readJsonFile<PackageJson>(packageJsonPath);
      if (packageJson.dependencies?.express || packageJson.devDependencies?.express) {
        return true;
      }
    } catch {
      // Fall through to source scan.
    }
  }

  const sourceFiles = await listFiles(
    root,
    (filePath) => /\.(?:[cm]?js|ts)$/.test(filePath) && !filePath.endsWith(".d.ts"),
    { ignoreDirectories: ["node_modules", ".git", "dist", "coverage"] },
  );

  for (const filePath of sourceFiles) {
    const content = await fs.readFile(filePath, "utf8");
    if (
      content.includes(`from "express"`)
      || content.includes(`from 'express'`)
      || content.includes(`require("express")`)
      || content.includes(`require('express')`)
    ) {
      return true;
    }
  }

  return false;
}

async function inferProjectName(root: string, framework: SupportedFramework): Promise<string> {
  if (framework === "laravel") {
    const composerPath = path.join(root, "composer.json");
    if (await fileExists(composerPath)) {
      try {
        const composer = await readJsonFile<ComposerJson>(composerPath);
        if (composer.name) {
          return composer.name;
        }
      } catch {
        return path.basename(root);
      }
    }
  }

  if (framework === "express") {
    const packageJsonPath = path.join(root, "package.json");
    if (await fileExists(packageJsonPath)) {
      try {
        const packageJson = await readJsonFile<PackageJson>(packageJsonPath);
        if (packageJson.name) {
          return packageJson.name;
        }
      } catch {
        return path.basename(root);
      }
    }
  }

  const goModPath = path.join(root, "go.mod");
  if (await fileExists(goModPath)) {
    try {
      const content = await fs.readFile(goModPath, "utf8");
      const match = content.match(/^module\s+(.+)$/m);
      if (match?.[1]) {
        return match[1].trim();
      }
    } catch {
      return path.basename(root);
    }
  }

  return path.basename(root);
}
