import * as path from "path";
import type { ShipyardConfig } from "../config";

function isSubPath(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateOutputPath(outputFile: string, config: ShipyardConfig): string | null {
  if (path.isAbsolute(outputFile)) {
    return `Output file must be relative to workDir: ${outputFile}`;
  }

  const outputDir = config.outputDir ?? "output";
  const outputRoot = path.resolve(config.workDir, outputDir);
  const resolvedOutput = path.resolve(config.workDir, outputFile);

  if (!isSubPath(resolvedOutput, outputRoot)) {
    return `Output file must stay within outputDir "${outputDir}": ${outputFile}`;
  }

  return null;
}
