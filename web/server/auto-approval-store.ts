/**
 * Per-project auto-approval config store.
 *
 * Each project (identified by an absolute directory path) can have its own
 * natural-language auto-approval criteria. Configs live as individual JSON
 * files in `~/.companion/auto-approval/`, following the env-manager pattern.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutoApprovalConfig {
  /** Canonical absolute path to the project directory */
  projectPath: string;
  /** Human-readable label (e.g. "companion", "my-api") */
  label: string;
  /** Stable slug derived from hashing projectPath — used as filename */
  slug: string;
  /** Free-form natural language criteria for auto-approval */
  criteria: string;
  /** Whether this config is active */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const COMPANION_DIR = join(homedir(), ".companion");
let storeDir = join(COMPANION_DIR, "auto-approval");

function ensureDir(): void {
  mkdirSync(storeDir, { recursive: true });
}

function filePath(slug: string): string {
  return join(storeDir, `${slug}.json`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a deterministic 12-char hex slug from a project path. */
export function slugFromPath(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

/** Normalize a project path: resolve trailing slashes, but keep as-is otherwise. */
function normalizePath(p: string): string {
  // Remove trailing slash unless it's the root "/"
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function listConfigs(): AutoApprovalConfig[] {
  ensureDir();
  try {
    const files = readdirSync(storeDir).filter((f) => f.endsWith(".json"));
    const configs: AutoApprovalConfig[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(storeDir, file), "utf-8");
        configs.push(JSON.parse(raw));
      } catch {
        // Skip corrupt files
      }
    }
    configs.sort((a, b) => a.label.localeCompare(b.label));
    return configs;
  } catch {
    return [];
  }
}

export function getConfig(slug: string): AutoApprovalConfig | null {
  ensureDir();
  try {
    const raw = readFileSync(filePath(slug), "utf-8");
    return JSON.parse(raw) as AutoApprovalConfig;
  } catch {
    return null;
  }
}

/**
 * Find the config that matches a session's working directory.
 * Uses longest-prefix matching: a session in `/home/user/project/sub`
 * matches `/home/user/project` rather than `/home/user`.
 *
 * `extraPaths` allows callers to supply additional paths to match against
 * (e.g. the git repo root for worktree sessions whose cwd differs from
 * the main repo path).
 *
 * Returns null if no config matches.
 */
export function getConfigForPath(cwd: string, extraPaths?: string[]): AutoApprovalConfig | null {
  const candidates = [normalizePath(cwd)];
  if (extraPaths) {
    for (const p of extraPaths) {
      const n = normalizePath(p);
      if (n && !candidates.includes(n)) candidates.push(n);
    }
  }

  const configs = listConfigs().filter((c) => c.enabled);

  let bestMatch: AutoApprovalConfig | null = null;
  let bestLen = 0;

  for (const config of configs) {
    const normalizedProject = normalizePath(config.projectPath);
    for (const normalizedCwd of candidates) {
      if (
        normalizedCwd === normalizedProject ||
        normalizedCwd.startsWith(normalizedProject + "/")
      ) {
        if (normalizedProject.length > bestLen) {
          bestLen = normalizedProject.length;
          bestMatch = config;
        }
      }
    }
  }

  return bestMatch;
}

export function createConfig(
  projectPath: string,
  label: string,
  criteria: string,
  enabled: boolean = true,
): AutoApprovalConfig {
  if (!projectPath || !projectPath.trim()) {
    throw new Error("Project path is required");
  }
  if (!label || !label.trim()) {
    throw new Error("Label is required");
  }

  const normalized = normalizePath(projectPath.trim());
  const slug = slugFromPath(normalized);

  ensureDir();
  if (existsSync(filePath(slug))) {
    throw new Error(`A config for this project path already exists`);
  }

  const now = Date.now();
  const config: AutoApprovalConfig = {
    projectPath: normalized,
    label: label.trim(),
    slug,
    criteria: criteria.trim(),
    enabled,
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(filePath(slug), JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export function updateConfig(
  slug: string,
  updates: { label?: string; criteria?: string; enabled?: boolean },
): AutoApprovalConfig | null {
  ensureDir();
  const existing = getConfig(slug);
  if (!existing) return null;

  const config: AutoApprovalConfig = {
    ...existing,
    ...(updates.label !== undefined ? { label: updates.label.trim() } : {}),
    ...(updates.criteria !== undefined ? { criteria: updates.criteria.trim() } : {}),
    ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
    updatedAt: Date.now(),
  };

  writeFileSync(filePath(slug), JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export function deleteConfig(slug: string): boolean {
  ensureDir();
  if (!existsSync(filePath(slug))) return false;
  try {
    unlinkSync(filePath(slug));
    return true;
  } catch {
    return false;
  }
}

// ─── Test helpers ───────────────────────────────────────────────────────────

/** Override the store directory for tests. */
export function _setStoreDirForTest(dir: string): void {
  storeDir = dir;
}

export function _resetStoreDir(): void {
  storeDir = join(COMPANION_DIR, "auto-approval");
}
