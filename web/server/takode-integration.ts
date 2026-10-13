import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { buildInstalledCliWrapper, COMPANION_BIN_DIR, resolveStableWrapperScriptPath } from "./cli-wrapper-paths.js";

/**
 * Set up the Takode CLI and MCP server wrapper scripts in ~/.companion/bin.
 * Skill symlinking is handled centrally by ensureSkillSymlinks().
 */
export async function ensureTakodeIntegration(packageRoot: string): Promise<void> {
  mkdirSync(COMPANION_BIN_DIR, { recursive: true }); // sync-ok: startup cold path
  for (const commandName of ["takode", "takode-sidecar-mcp", "takode-web-search-mcp", "agent-browser"]) {
    const wrapperPath = join(COMPANION_BIN_DIR, commandName);
    const stableScript = await resolveStableWrapperScriptPath(packageRoot, commandName);
    writeFileSync(wrapperPath, buildInstalledCliWrapper(commandName, stableScript), "utf-8"); // sync-ok: startup cold path
    chmodSync(wrapperPath, 0o755); // sync-ok: startup cold path
  }

  console.log("[takode-integration] CLI wrappers installed");
}
