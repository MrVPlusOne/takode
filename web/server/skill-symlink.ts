import {
  existsSync,
  mkdirSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
  readdirSync,
  unlinkSync,
  rmSync,
  type Dirent,
} from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getLegacyCodexHome } from "./codex-home.js";
import { resolveStableWrapperRepoRoot } from "./cli-wrapper-paths.js";

/**
 * Resolve the main repository root, not the current worktree.
 * In a worktree, `import.meta.url` points to an ephemeral path that breaks when
 * the worktree is removed. `git rev-parse --git-common-dir` gives the main repo's
 * .git directory, from which we derive a stable root.
 */
let mainRepoRootPromise: Promise<string> | null = null;

function resolveMainRepoRoot(): Promise<string> {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  mainRepoRootPromise ??= resolveStableWrapperRepoRoot(packageRoot);
  return mainRepoRootPromise;
}

const HOME = homedir();
const CLAUDE_SKILLS_HOME = join(HOME, ".claude", "skills");
const AGENTS_SKILLS_HOME = join(HOME, ".agents", "skills");
const LEGACY_CODEX_SKILLS_HOME = join(getLegacyCodexHome(), "skills");
const QUEST_JOURNEY_PHASE_SKILL_SLUGS = [
  "quest-journey-alignment",
  "quest-journey-explore",
  "quest-journey-implement",
  "quest-journey-code-review",
  "quest-journey-mental-simulation",
  "quest-journey-execute",
  "quest-journey-outcome-review",
  "quest-journey-user-checkpoint",
  "quest-journey-bookkeeping",
  "quest-journey-port",
];
const DEPRECATED_PROJECT_SKILL_SLUGS = new Set([
  ...QUEST_JOURNEY_PHASE_SKILL_SLUGS,
  "impeccable",
  "quest-journey-planning",
  "quest-journey-implementation",
  "quest-journey-skeptic-review",
  "quest-journey-reviewer-groom",
  "quest-journey-porting",
]);
const LEGACY_CODEX_PROJECT_OWNED_SKILL_SLUGS = new Set(["quest"]);

export interface SkillSymlinkRoots {
  mainRepoRoot: string;
  claudeSkillsHome: string;
  agentsSkillsHome: string;
  legacyCodexSkillsHome: string;
}

/**
 * Symlink repo skills into the global Claude and agent skill homes so all
 * sessions discover the same project-defined skills regardless of working
 * directory. `.agents` is the non-Claude source used by Codex/new agents;
 * legacy `.codex/skills` content is compatibility-only migration input.
 *
 * Call once at startup with the core skill directory names (slugs). Startup
 * also discovers repo skill slugs from `.claude/skills` and `.agents/skills`
 * so agent-only project skills are installed without touching Claude's root.
 */
export async function ensureSkillSymlinks(slugs: string[], roots?: SkillSymlinkRoots): Promise<void> {
  assertCompleteSkillSymlinkRoots(roots);
  const mainRepoRoot = roots?.mainRepoRoot ?? (await resolveMainRepoRoot());
  const repoClaudeSkillsHome = join(mainRepoRoot, ".claude", "skills");
  const repoAgentsSkillsHome = join(mainRepoRoot, ".agents", "skills");
  const claudeSkillsHome = roots?.claudeSkillsHome ?? CLAUDE_SKILLS_HOME;
  const agentsSkillsHome = roots?.agentsSkillsHome ?? AGENTS_SKILLS_HOME;
  const legacyCodexSkillsHome = roots?.legacyCodexSkillsHome ?? LEGACY_CODEX_SKILLS_HOME;

  migrateLegacyCodexSkillsToAgents(legacyCodexSkillsHome, agentsSkillsHome);
  removeDeprecatedProjectSkillSymlinks(claudeSkillsHome, agentsSkillsHome, legacyCodexSkillsHome);
  removeLegacyCodexProjectOwnedSkillCopies(legacyCodexSkillsHome);

  const allSlugs = discoverRepoSkillSlugs(slugs, repoClaudeSkillsHome, repoAgentsSkillsHome);
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const slug of allSlugs) {
    const repoClaudeDir = join(repoClaudeSkillsHome, slug);
    const repoAgentsDir = join(repoAgentsSkillsHome, slug);
    const claudeTarget = join(claudeSkillsHome, slug);
    const agentsTarget = join(agentsSkillsHome, slug);
    const claudeSource = await installFirstUsableSkillSource([repoClaudeDir], claudeTarget);
    const agentsSource = await installFirstUsableSkillSource([repoAgentsDir, repoClaudeDir], agentsTarget);

    if (claudeSource) installed.push(`${slug}:claude`);
    else skipped.push(`${slug}:claude`);
    if (agentsSource) installed.push(`${slug}:agents`);
    else skipped.push(`${slug}:agents`);

    if (!claudeSource && !agentsSource) {
      console.warn(`[skill-symlink] Skipping repo skill without usable SKILL.md: ${repoClaudeDir} or ${repoAgentsDir}`);
    }
  }
  console.log(
    `[skill-symlink] Installed ${installed.length > 0 ? installed.join(", ") : "none"}; skipped ${
      skipped.length > 0 ? skipped.join(", ") : "none"
    }`,
  );
}

function assertCompleteSkillSymlinkRoots(roots: SkillSymlinkRoots | undefined): void {
  if (roots === undefined) return;
  const requiredRoots: Array<keyof SkillSymlinkRoots> = [
    "mainRepoRoot",
    "claudeSkillsHome",
    "agentsSkillsHome",
    "legacyCodexSkillsHome",
  ];
  if (requiredRoots.some((key) => typeof roots[key] !== "string" || roots[key].trim().length === 0)) {
    throw new Error(`[skill-symlink] Disposable roots must provide ${requiredRoots.join(", ")} together`);
  }
}

async function installFirstUsableSkillSource(candidates: string[], targetDir: string): Promise<string | null> {
  for (const sourceDir of candidates) {
    if (!(await hasUsableSkillPayload(sourceDir))) continue;
    ensureSymlink(sourceDir, targetDir);
    if (await hasUsableSkillPayload(targetDir)) return sourceDir;
    removeDeprecatedProjectSkillPath(targetDir);
  }
  removeDeprecatedProjectSkillPath(targetDir);
  return null;
}

async function hasUsableSkillPayload(skillDir: string): Promise<boolean> {
  const skillPath = join(skillDir, "SKILL.md");
  try {
    const skillStat = await stat(skillPath);
    if (!skillStat.isFile()) return false;
    return hasRequiredSkillContent(await readFile(skillPath, "utf-8"));
  } catch {
    return false;
  }
}

function hasRequiredSkillContent(content: string): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content.trimEnd());
  if (!match) return false;
  const frontmatterLines = match[1].split(/\r?\n/);
  return (
    hasSemanticFrontmatterValue(frontmatterLines, "name") &&
    hasSemanticFrontmatterValue(frontmatterLines, "description") &&
    hasSemanticMarkdownBody(match[2])
  );
}

function hasSemanticFrontmatterValue(lines: string[], key: "name" | "description"): boolean {
  const matches = lines.flatMap((line, index) => {
    const match = new RegExp(`^${key}:\\s*(.*)$`).exec(line);
    return match ? [{ index, raw: match[1].trim() }] : [];
  });
  if (matches.length !== 1) return false;
  const { index, raw } = matches[0];
  if (/^[>|][+-]?(?:\s+#.*)?$/.test(raw)) {
    for (const line of lines.slice(index + 1)) {
      if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
      if (!/^\s+/.test(line)) break;
      if (isSemanticText(line.trim())) return true;
    }
    return false;
  }
  if (/^[>|]/.test(raw)) return false;
  return parseSemanticScalar(raw) !== null;
}

function parseSemanticScalar(raw: string): string | null {
  if (raw.startsWith('"')) return parseDoubleQuotedScalar(raw);
  if (raw.startsWith("'")) return parseSingleQuotedScalar(raw);
  const commentIndex = raw.search(/(^|\s)#/);
  const value = (commentIndex >= 0 ? raw.slice(0, commentIndex) : raw).trim();
  return isSupportedPlainString(value) ? value : null;
}

function isSupportedPlainString(value: string): boolean {
  if (!isSemanticText(value)) return false;
  if ("!&*%@,`[]{}".includes(value[0])) return false;
  if (/^(?:-\s|\?\s|:\s)/.test(value)) return false;
  if (/[\[\]{}]/.test(value) || /:\s/.test(value)) return false;
  return !isImplicitNonStringScalar(value);
}

function isImplicitNonStringScalar(value: string): boolean {
  if (/^(?:~|null|true|false|y|n|yes|no|on|off)$/i.test(value)) return true;
  if (/^[+-]?(?:\.inf|\.nan|infinity|nan)$/i.test(value)) return true;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) return true;
  if (
    /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt]|\s+)\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:\s*(?:Z|[+-]\d{1,2}(?::?\d{2})?))?$/i.test(value)
  )
    return true;
  if (/^[+-]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/.test(value)) return true;
  return (
    /^[+-]?0[bB][01_]+$/.test(value) ||
    /^[+-]?0[oO][0-7_]+$/.test(value) ||
    /^[+-]?0[xX][0-9a-fA-F_]+$/.test(value) ||
    /^[+-]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9][0-9_]*)?$/.test(value) ||
    /^[+-]?\.[0-9_]+(?:[eE][+-]?[0-9][0-9_]*)?$/.test(value)
  );
}

function parseDoubleQuotedScalar(raw: string): string | null {
  let escaped = false;
  for (let index = 1; index < raw.length; index += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (raw[index] === "\\") {
      escaped = true;
      continue;
    }
    if (raw[index] !== '"') continue;
    const tail = raw.slice(index + 1).trim();
    if (tail.length > 0 && !tail.startsWith("#")) return null;
    try {
      const value = JSON.parse(raw.slice(0, index + 1));
      return typeof value === "string" && isSemanticText(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseSingleQuotedScalar(raw: string): string | null {
  let value = "";
  for (let index = 1; index < raw.length; index += 1) {
    if (raw[index] !== "'") {
      value += raw[index];
      continue;
    }
    if (raw[index + 1] === "'") {
      value += "'";
      index += 1;
      continue;
    }
    const tail = raw.slice(index + 1).trim();
    if (tail.length > 0 && !tail.startsWith("#")) return null;
    return isSemanticText(value) ? value : null;
  }
  return null;
}

function isSemanticText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.startsWith("#");
}

function hasSemanticMarkdownBody(body: string): boolean {
  return body.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim().length > 0;
}

function discoverRepoSkillSlugs(
  requiredSlugs: string[],
  repoClaudeSkillsHome: string,
  repoAgentsSkillsHome: string,
): string[] {
  return [
    ...new Set([
      ...requiredSlugs,
      ...readRepoSkillSlugs(repoClaudeSkillsHome),
      ...readRepoSkillSlugs(repoAgentsSkillsHome),
    ]),
  ].filter((slug) => !isDeprecatedProjectSkillSlug(slug));
}

function migrateLegacyCodexSkillsToAgents(legacyCodexSkillsHome: string, agentsSkillsHome: string): void {
  if (!existsSync(legacyCodexSkillsHome)) return; // sync-ok: startup cold path

  let entries: Dirent[];
  try {
    entries = readdirSync(legacyCodexSkillsHome, { withFileTypes: true }); // sync-ok: startup cold path
  } catch (error) {
    console.warn(`[skill-symlink] Failed to inspect legacy Codex skills:`, error);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (isDeprecatedProjectSkillSlug(entry.name)) continue;
    if (isLegacyCodexProjectOwnedSkillSlug(entry.name)) continue;
    const legacyDir = join(legacyCodexSkillsHome, entry.name);
    const agentsDir = join(agentsSkillsHome, entry.name);
    if (existsSync(agentsDir)) continue; // sync-ok: startup cold path
    ensureSymlink(legacyDir, agentsDir);
  }
}

function removeLegacyCodexProjectOwnedSkillCopies(legacyCodexSkillsHome: string): void {
  for (const slug of LEGACY_CODEX_PROJECT_OWNED_SKILL_SLUGS) {
    removeDeprecatedProjectSkillPath(join(legacyCodexSkillsHome, slug));
  }
}

function removeDeprecatedProjectSkillSymlinks(
  claudeSkillsHome: string,
  agentsSkillsHome: string,
  legacyCodexSkillsHome: string,
): void {
  for (const slug of DEPRECATED_PROJECT_SKILL_SLUGS) {
    removeDeprecatedProjectSkillPath(join(claudeSkillsHome, slug));
    removeDeprecatedProjectSkillPath(join(agentsSkillsHome, slug));
    removeDeprecatedProjectSkillPath(join(legacyCodexSkillsHome, slug));
  }
}

function removeDeprecatedProjectSkillPath(targetDir: string): void {
  try {
    const stat = lstatSync(targetDir); // sync-ok: startup cold path
    if (stat.isSymbolicLink()) {
      unlinkSync(targetDir); // sync-ok: startup cold path
      return;
    }
    rmSync(targetDir, { recursive: true }); // sync-ok: startup cold path
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

export function isDeprecatedProjectSkillSlug(slug: string): boolean {
  return DEPRECATED_PROJECT_SKILL_SLUGS.has(slug);
}

export function isLegacyCodexProjectOwnedSkillSlug(slug: string): boolean {
  return LEGACY_CODEX_PROJECT_OWNED_SKILL_SLUGS.has(slug);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function readRepoSkillSlugs(repoSkillsHome: string): string[] {
  if (!existsSync(repoSkillsHome)) return []; // sync-ok: startup cold path

  try {
    return readdirSync(repoSkillsHome, { withFileTypes: true }) // sync-ok: startup cold path
      .filter((entry) => !entry.name.startsWith("."))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch (error) {
    console.warn(`[skill-symlink] Failed to inspect repo skills: ${repoSkillsHome}`, error);
    return [];
  }
}

/**
 * Idempotent symlink: points targetDir → sourceDir, replacing whatever
 * was there before (stale symlink, real directory from old copy-based install, etc.).
 */
function ensureSymlink(sourceDir: string, targetDir: string): void {
  mkdirSync(dirname(targetDir), { recursive: true }); // sync-ok: startup cold path

  try {
    const stat = lstatSync(targetDir); // sync-ok: startup cold path
    if (stat.isSymbolicLink()) {
      if (readlinkSync(targetDir) === sourceDir) return; // sync-ok: startup cold path
      unlinkSync(targetDir); // sync-ok: startup cold path
    } else {
      rmSync(targetDir, { recursive: true }); // sync-ok: startup cold path
    }
  } catch {
    // Doesn't exist -- will create below
  }

  symlinkSync(sourceDir, targetDir); // sync-ok: startup cold path
}
