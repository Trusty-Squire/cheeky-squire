import { parseMission, parseChains, resolveChain } from "./schema.js";
import { SquireError } from "../errors.js";
import * as fs from "fs";
import * as path from "path";
import * as fg from "fast-glob";

export interface ValidationIssue {
  level: "error" | "warn";
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Validates a mission file and its dependencies.
 * @param missionPath Path to the mission.yaml file
 * @param chainsPath Path to the chains.yaml file
 * @returns Validation result with ok flag and issues
 */
export function validateMissionFile(missionPath: string, chainsPath: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  let mission;
  let chains;

  // Parse mission file
  try {
    const missionText = fs.readFileSync(missionPath, "utf-8");
    mission = parseMission(missionText, missionPath);
  } catch (err) {
    if (err instanceof SquireError) {
      issues.push({
        level: "error",
        message: err.message,
      });
      return { ok: false, issues };
    }
    throw err;
  }

  // Parse chains file
  try {
    const chainsText = fs.readFileSync(chainsPath, "utf-8");
    chains = parseChains(chainsText, chainsPath);
  } catch (err) {
    if (err instanceof SquireError) {
      issues.push({
        level: "error",
        message: err.message,
      });
      return { ok: false, issues };
    }
    throw err;
  }

  // Resolve chain
  try {
    resolveChain(chains, mission.chain);
  } catch (err) {
    if (err instanceof SquireError) {
      issues.push({
        level: "error",
        message: err.message,
      });
      return { ok: false, issues };
    }
    throw err;
  }

  // Resolve workdir relative to the directory containing the mission file
  const missionDir = path.dirname(missionPath);
  const resolvedWorkdir = path.resolve(missionDir, mission.workdir);

  // Validate nodes
  for (const node of mission.nodes) {
    // Check that blast_radius is not empty
    if (node.blast_radius.length === 0) {
      issues.push({
        level: "error",
        message: "blast_radius must not be empty",
        nodeId: node.id,
      });
    }

    // Check context_globs match files (warning only)
    for (const glob of node.context_globs) {
      try {
        const matchedFiles = fg.sync(glob, { 
          cwd: resolvedWorkdir, 
          onlyFiles: true 
        });
        if (matchedFiles.length === 0) {
          issues.push({
            level: "warn",
            message: `context_globs pattern "${glob}" matches no files`,
            nodeId: node.id,
          });
        }
      } catch (err) {
        issues.push({
          level: "warn",
          message: `Failed to evaluate context_globs pattern "${glob}": ${err instanceof Error ? err.message : String(err)}`,
          nodeId: node.id,
        });
      }
    }
  }

  // Check if there are any error-level issues
  const hasErrors = issues.some(issue => issue.level === "error");
  
  return {
    ok: !hasErrors,
    issues,
  };
}