import * as path from "path";
import type { ShipyardConfig } from "../config";

function isSubPath(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateOutputPath(outputFile: string, config: ShipyardConfig): string | null {
  const outputDir = config.outputDir ?? "output";
  const outputRoot = path.resolve(config.workDir, outputDir);
  const resolvedOutput = path.isAbsolute(outputFile) ? path.resolve(outputFile) : path.resolve(config.workDir, outputFile);

  if (!isSubPath(resolvedOutput, outputRoot)) {
    return `Output file must stay within outputDir "${outputDir}": ${outputFile}`;
  }

  return null;
}
