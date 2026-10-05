import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { PersistedSession } from "./session-store.js";

/** Sync a complete candidate before atomically replacing the previous session file. */
export async function replaceSessionFile(path: string, chunks: Iterable<string>): Promise<void> {
  // Non-JSON suffix keeps interrupted candidates out of startup discovery.
  const candidate = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(candidate, "wx", 0o600);
    try {
      await writeChunks(file, chunks);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(candidate, path);
  } finally {
    try {
      await unlink(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[session-store] Could not remove candidate ${candidate}:`, error);
      }
    }
  }
}

/** Write the existing JSONL format without building a whole frozen-batch string. */
export async function writeFrozenHistory(
  path: string,
  sessionId: string,
  messages: PersistedSession["messageHistory"],
  toolResults: NonNullable<PersistedSession["toolResults"]>,
  append: boolean,
): Promise<void> {
  const chunks = frozenChunks(sessionId, messages, toolResults, !append);
  if (!append) return replaceSessionFile(path, chunks);

  const file = await open(path, "a+");
  let originalSize: number | undefined;
  try {
    originalSize = (await file.stat()).size;
    await writeChunks(file, chunks);
    await file.sync();
  } catch (error) {
    // Failed appends must not leave half a record that a retry could extend.
    try {
      if (originalSize !== undefined) {
        await file.truncate(originalSize);
        await file.sync();
      }
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Failed to restore frozen prefix: ${path}`);
    }
    throw error;
  } finally {
    await file.close();
  }
}

async function writeChunks(file: FileHandle, chunks: Iterable<string>): Promise<void> {
  let pending = "";
  for (const chunk of chunks) {
    pending += chunk;
    if (pending.length < 64 * 1024) continue;
    await file.writeFile(pending, "utf8");
    pending = "";
  }
  if (pending) await file.writeFile(pending, "utf8");
}

function* frozenChunks(
  sessionId: string,
  messages: PersistedSession["messageHistory"],
  toolResults: NonNullable<PersistedSession["toolResults"]>,
  header: boolean,
): Generator<string> {
  if (header) yield JSON.stringify({ v: 1, sessionId }) + "\n";
  for (const message of messages) yield JSON.stringify(message) + "\n";
  if (!toolResults.length) return;
  yield '{"_toolResults":[';
  for (let index = 0; index < toolResults.length; index++) {
    if (index) yield ",";
    yield JSON.stringify(toolResults[index]);
  }
  yield "]}\n";
}
