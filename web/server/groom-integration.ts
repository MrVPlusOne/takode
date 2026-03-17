import { mkdirSync, symlinkSync, lstatSync, readlinkSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO_SKILL_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), ".claude", "skills", "groom");
const CLAUDE_SKILL_DIR = join(homedir(), ".claude", "skills", "groom");
const CODEX_SKILL_DIR = join(homedir(), ".codex", "skills", "groom");

/**
 * Set up the /groom skill for both Claude Code and Codex sessions.
 * Creates symlinks from the user's global skill directories to the
 * repo-local copy so all sessions discover it automatically.
 */
export function ensureGroomIntegration(): void {
  ensureSkillSymlink(CLAUDE_SKILL_DIR);
  ensureSkillSymlink(CODEX_SKILL_DIR);
  console.log("[groom-integration] skill symlinked for Claude and Codex");
}

function ensureSkillSymlink(targetDir: string): void {
  mkdirSync(dirname(targetDir), { recursive: true }); // sync-ok: startup cold path

  // If it already exists, check if it's the correct symlink
  try {
    const stat = lstatSync(targetDir); // sync-ok: startup cold path
    if (stat.isSymbolicLink()) {
      const existing = readlinkSync(targetDir); // sync-ok: startup cold path
      if (existing === REPO_SKILL_DIR) return; // Already correct
      // Wrong target — remove and re-create
      unlinkSync(targetDir); // sync-ok: startup cold path
    } else {
      // It's a real directory (e.g. from a previous copy-based install) — remove it
      // so we can replace with a symlink to the repo copy
      rmSync(targetDir, { recursive: true }); // sync-ok: startup cold path
    }
  } catch {
    // Doesn't exist — fine, we'll create it
  }

  symlinkSync(REPO_SKILL_DIR, targetDir); // sync-ok: startup cold path
}
