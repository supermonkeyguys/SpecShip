import * as path from "path";
import type { ShipyardConfig } from "../config";

function isSubPath(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizePathString(value: string): string {
  return value.replace(/[\\/]+/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePathString(glob);
  const placeholder = "__DOUBLE_STAR__";
  const withPlaceholder = normalized.replace(/\*\*/g, placeholder);
  const escaped = escapeRegExp(withPlaceholder);
  const regexSource = `^${escaped
    .replace(new RegExp(placeholder, "g"), ".*")
    .replace(/\*/g, "[^/]*")}$`;
  return new RegExp(regexSource);
}

function matchesAnyGlob(relativePath: string, globs: string[]): boolean {
  const normalized = normalizePathString(relativePath);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

export function getExecutionMode(config: ShipyardConfig): "sandbox-output" | "repo-edit" {
  return config.executionMode ?? "sandbox-output";
}

export function normalizeSandboxOutputFile(
  outputFile: string,
  config: Pick<ShipyardConfig, "outputDir" | "executionMode">
): string {
  if (getExecutionMode(config as ShipyardConfig) === "repo-edit") return outputFile;

  const outputDir = normalizePathString(config.outputDir ?? "output").replace(/\/$/, "");
  const normalized = normalizePathString(outputFile);

  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("../") ||
    normalized === ".."
  ) {
    return outputFile;
  }

  if (normalized === outputDir || normalized.startsWith(`${outputDir}/`)) {
    return normalized;
  }

  const outputDirBasename = outputDir.split("/").at(-1) ?? outputDir;
  if (normalized === outputDirBasename || normalized.startsWith(`${outputDirBasename}/`)) {
    return `${outputDir}/${normalized.slice(outputDirBasename.length).replace(/^\/+/, "")}`;
  }

  return `${outputDir}/${normalized}`;
}

export function validateOutputPath(outputFile: string, config: ShipyardConfig): string | null {
  const normalizedOutputFile = outputFile.replace(/[\\/]+/g, path.sep);

  if (getExecutionMode(config) === "repo-edit") {
    const resolvedOutput = path.isAbsolute(normalizedOutputFile)
      ? path.resolve(normalizedOutputFile)
      : path.resolve(config.workDir, normalizedOutputFile);

    if (!config.repoPath) return `repo-edit mode requires repoPath: ${outputFile}`;
    const repoRoot = path.resolve(config.repoPath);
    if (!isSubPath(resolvedOutput, repoRoot)) {
      return `Output file must stay within repoPath "${config.repoPath}": ${outputFile}`;
    }

    const relativeToRepo = normalizePathString(path.relative(repoRoot, resolvedOutput));
    const allowedWriteGlobs = config.workspacePolicy?.allowedWriteGlobs ?? [];
    const forbiddenPaths = config.workspacePolicy?.forbiddenPaths ?? [];

    if (allowedWriteGlobs.length === 0) {
      return `repo-edit mode requires workspacePolicy.allowedWriteGlobs: ${outputFile}`;
    }

    if (!matchesAnyGlob(relativeToRepo, allowedWriteGlobs)) {
      return `Output file is outside allowed write globs (${allowedWriteGlobs.join(", ")}): ${outputFile}`;
    }

    if (forbiddenPaths.length > 0 && matchesAnyGlob(relativeToRepo, forbiddenPaths)) {
      return `Output file matches forbidden path policy (${forbiddenPaths.join(", ")}): ${outputFile}`;
    }

    return null;
  }

  const outputDir = config.outputDir ?? "output";
  const outputRoot = path.resolve(config.workDir, outputDir);
  const sandboxRelative = path.isAbsolute(normalizedOutputFile)
    ? normalizedOutputFile
    : normalizeSandboxOutputFile(outputFile, config).replace(/[\\/]+/g, path.sep);
  const resolvedOutput = path.isAbsolute(sandboxRelative)
    ? path.resolve(sandboxRelative)
    : path.resolve(config.workDir, sandboxRelative);

  if (!isSubPath(resolvedOutput, outputRoot)) {
    return `Output file must stay within outputDir "${outputDir}": ${outputFile}`;
  }

  return null;
}
