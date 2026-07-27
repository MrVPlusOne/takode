import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { getLegacyCodexHome } from "./codex-home.js";

type YieldingTiming = {
  yieldIfDue(label: string): Promise<unknown>;
};

async function findCodexRolloutPath(codexHome: string, threadId: string): Promise<string | null> {
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
