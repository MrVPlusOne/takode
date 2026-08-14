import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { getLegacyCodexHome } from "./codex-home.js";

type YieldingTiming = {
  yieldIfDue(label: string): Promise<unknown>;
};

export interface CodexRolloutDiscoveryLimits {
  maxYears?: number;
  maxMonthsPerYear?: number;
  maxDaysPerMonth?: number;
  maxDayDirectories?: number;
  maxEntriesPerDay?: number;
}

export interface CodexRolloutDiscoveryResult {
  path: string | null;
  truncated: boolean;
}

const DEFAULT_DIAGNOSTIC_DISCOVERY_LIMITS = {
  maxYears: 16,
  maxMonthsPerYear: 12,
  maxDaysPerMonth: 31,
  maxDayDirectories: 128,
  maxEntriesPerDay: 4096,
} as const;

function boundedNewestNames(names: string[], pattern: RegExp, limit: number): { names: string[]; truncated: boolean } {
  const matching = names.filter((name) => pattern.test(name)).sort((a, b) => b.localeCompare(a));
  return { names: matching.slice(0, limit), truncated: matching.length > limit };
}

/** Newest-first, fail-closed discovery for diagnostics and startup reconciliation. */
export async function findCodexRolloutPathBounded(
  codexHome: string,
  threadId: string,
  limits: CodexRolloutDiscoveryLimits = {},
): Promise<CodexRolloutDiscoveryResult> {
  const resolved = { ...DEFAULT_DIAGNOSTIC_DISCOVERY_LIMITS, ...limits };
  const sessionsRoot = join(codexHome, "sessions");
  const yearResult = boundedNewestNames(await readdir(sessionsRoot).catch(() => []), /^\d{4}$/, resolved.maxYears);
  let truncated = yearResult.truncated;
  let visitedDayDirectories = 0;

  for (const year of yearResult.names) {
    const yearPath = join(sessionsRoot, year);
    const monthResult = boundedNewestNames(
      await readdir(yearPath).catch(() => []),
      /^(?:0[1-9]|1[0-2])$/,
      resolved.maxMonthsPerYear,
    );
    truncated ||= monthResult.truncated;
    for (const month of monthResult.names) {
      const monthPath = join(yearPath, month);
      const dayResult = boundedNewestNames(
        await readdir(monthPath).catch(() => []),
        /^(?:0[1-9]|[12]\d|3[01])$/,
        resolved.maxDaysPerMonth,
      );
      truncated ||= dayResult.truncated;
      for (const day of dayResult.names) {
        if (visitedDayDirectories >= resolved.maxDayDirectories) return { path: null, truncated: true };
        visitedDayDirectories++;
        const dayPath = join(monthPath, day);
        const entries = await readdir(dayPath, { withFileTypes: true }).catch(() => []);
        const newestFiles = entries.filter((entry) => entry.isFile()).sort((a, b) => b.name.localeCompare(a.name));
        const boundedEntries = newestFiles.slice(0, resolved.maxEntriesPerDay);
        truncated ||= newestFiles.length > boundedEntries.length;
        const newestMatch = boundedEntries.find((entry) => entry.name.endsWith(`${threadId}.jsonl`))?.name;
        if (newestMatch) return { path: join(dayPath, newestMatch), truncated };
      }
    }
  }
  return { path: null, truncated };
}

export async function findCodexRolloutPath(codexHome: string, threadId: string): Promise<string | null> {
  const sessionsRoot = join(codexHome, "sessions");
  const years = await readdir(sessionsRoot).catch(() => []);

  let newest: { path: string; mtimeMs: number } | null = null;
  for (const year of years) {
    const yearPath = join(sessionsRoot, year);
    const months = await readdir(yearPath).catch(() => []);
    for (const month of months) {
      const monthPath = join(yearPath, month);
      const days = await readdir(monthPath).catch(() => []);
      for (const day of days) {
        const dayPath = join(monthPath, day);
        const entries = await readdir(dayPath).catch(() => []);
        for (const entry of entries) {
          if (!entry.endsWith(`${threadId}.jsonl`)) continue;
          const fullPath = join(dayPath, entry);
          const entryStat = await stat(fullPath).catch(() => null);
          if (!entryStat?.isFile()) continue;
          if (!newest || entryStat.mtimeMs > newest.mtimeMs) {
            newest = { path: fullPath, mtimeMs: entryStat.mtimeMs };
          }
        }
      }
    }
  }

  return newest?.path ?? null;
}

export async function seedCodexResumeRollout(
  codexHome: string,
  threadId?: string,
  sourceHomes: string[] = [],
  timing?: YieldingTiming,
): Promise<void> {
  if (!threadId) return;
  const sourceCandidates = [...sourceHomes, getLegacyCodexHome()];
  const seen = new Set<string>();
  let rolloutPath: string | null = null;
  let sourceSessionsRoot: string | null = null;
  for (const sourceHome of sourceCandidates) {
    const resolvedSourceHome = resolve(sourceHome);
    if (seen.has(resolvedSourceHome)) continue;
    seen.add(resolvedSourceHome);
    rolloutPath = await findCodexRolloutPath(resolvedSourceHome, threadId);
    if (rolloutPath) {
      sourceSessionsRoot = join(resolvedSourceHome, "sessions");
      break;
    }
  }
  if (!rolloutPath || !sourceSessionsRoot) return;

  const relativeRolloutPath = relative(sourceSessionsRoot, rolloutPath);
  if (!relativeRolloutPath || relativeRolloutPath.startsWith("..")) return;

  const destPath = join(codexHome, "sessions", relativeRolloutPath);
  if (resolve(rolloutPath) === resolve(destPath)) return;
  await mkdir(dirname(destPath), { recursive: true });
  await timing?.yieldIfDue("prepare resume rollout directory");
  await copyFile(rolloutPath, destPath);
  await timing?.yieldIfDue("copy resume rollout");
}
