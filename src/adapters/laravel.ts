import type { BrunogenConfig, NormalizedProject } from "../core/model";
import { scanLaravelRoutes } from "./laravel/routes";

export async function scanLaravelProject(
  root: string,
  projectName: string,
  projectVersion: string,
  config: BrunogenConfig,
): Promise<NormalizedProject> {
  const { endpoints, warnings } = await scanLaravelRoutes(root, config);

  return {
    framework: "laravel",
    projectName,
    projectVersion,
    endpoints,
    warnings,
  };
}
