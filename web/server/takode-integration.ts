import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import {
  buildServerLocalCliWrapper,
  buildSharedCliDispatcher,
  COMPANION_BIN_DIR,
  getServerWrapperDir,
} from "./cli-wrapper-paths.js";

/**
 * Set up the Takode CLI wrapper script at ~/.companion/bin/takode.
 * Skill symlinking is handled centrally by ensureSkillSymlinks().
 */
export function ensureTakodeIntegration(packageRoot: string, serverId?: string): void {
  mkdirSync(COMPANION_BIN_DIR, { recursive: true }); // sync-ok: startup cold path
  const sharedWrapperPath = join(COMPANION_BIN_DIR, "takode");
  const sharedWrapper = buildSharedCliDispatcher("takode");

  writeFileSync(sharedWrapperPath, sharedWrapper, "utf-8"); // sync-ok: startup cold path
  chmodSync(sharedWrapperPath, 0o755); // sync-ok: startup cold path

  const serverWrapperDir = getServerWrapperDir(serverId);
  if (serverWrapperDir) {
    mkdirSync(serverWrapperDir, { recursive: true }); // sync-ok: startup cold path
    const serverWrapperPath = join(serverWrapperDir, "takode");
    const serverScript = join(packageRoot, "bin", "takode.ts");
    const serverWrapper = buildServerLocalCliWrapper("takode", serverScript);
    writeFileSync(serverWrapperPath, serverWrapper, "utf-8"); // sync-ok: startup cold path
    chmodSync(serverWrapperPath, 0o755); // sync-ok: startup cold path
  }

  console.log("[takode-integration] CLI wrappers installed");
}
