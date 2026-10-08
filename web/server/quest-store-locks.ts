import { mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

const LOCK_RETRY_MS = 10;

/**
 * Hold a cross-process lock while `fn` runs: the lock is a directory, created
 * atomically. A lock older than `staleMs` is assumed abandoned and broken;
 * waiting longer than twice that fails with "Timed out waiting for <label>".
 */
export async function withDirectoryLock<T>(
  lockDir: string,
  options: { staleMs: number; label: string },
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireDirectoryLock(lockDir, options);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquireDirectoryLock(
  lockDir: string,
  { staleMs, label }: { staleMs: number; label: string },
): Promise<() => Promise<void>> {
  await mkdir(dirname(lockDir), { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockDir);
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") throw err;

      if (await isStale(lockDir, staleMs)) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }

      if (Date.now() - startedAt > staleMs * 2) {
        throw new Error(`Timed out waiting for ${label}`);
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function isStale(lockDir: string, staleMs: number): Promise<boolean> {
  try {
    const lockStat = await stat(lockDir);
    return Date.now() - lockStat.mtimeMs > staleMs;
  } catch {
    return false;
  }
}
