import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";

/**
 * The whole quest store in the single-file format the store used until
 * November 2026, `JSON.stringify(store, null, 2)`: what whole-store backups and
 * the rollback export write. The store itself keeps one file per quest
 * (quest-store-dir.ts). Quests are frozen objects that stay the same between
 * reads, so each quest's serialized bytes are cached on the object and the
 * file is assembled from them: only quests that changed are serialized again,
 * and the bytes are identical to a whole-store stringify.
 */
const questBytes = new WeakMap<object, Buffer>();

/** Indentation of an element of the store's top-level `quests` array. */
const QUEST_INDENT = "    ";
const QUEST_SEPARATOR = Buffer.from(`,\n${QUEST_INDENT}`);
/** iovec batches stay under the system's IOV_MAX (1024). */
const WRITE_BATCH = 512;

/**
 * The bytes of `JSON.stringify(store, null, 2)`, in order, built from cached
 * per-quest bytes. Only frozen quests are cached, since a mutable object could
 * change after its bytes were taken.
 */
export function questStoreFileChunks(store: { quests: readonly object[] }): Buffer[] {
  if (store.quests.length === 0) return [Buffer.from(JSON.stringify(store, null, 2))];
  // Render everything but the quests with a stand-in for the array's contents;
  // overriding an existing key keeps its position, so the layout is unchanged.
  const placeholder = `quests-${randomUUID()}`;
  const [head, tail] = JSON.stringify({ ...store, quests: [placeholder] }, null, 2).split(JSON.stringify(placeholder));
  const chunks: Buffer[] = [Buffer.from(head!)];
  store.quests.forEach((quest, index) => {
    if (index > 0) chunks.push(QUEST_SEPARATOR);
    chunks.push(serializedQuest(quest));
  });
  chunks.push(Buffer.from(tail!));
  return chunks;
}

/**
 * Replace `path` with the chunks through a temporary file. The bytes go to the
 * kernel in batches without first being joined into one buffer, so the event
 * loop keeps running while the file is written.
 */
export async function replaceFileWithChunks(path: string, chunks: readonly Buffer[]): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(tempPath, "wx");
    try {
      for (let start = 0; start < chunks.length; start += WRITE_BATCH) {
        const batch = chunks.slice(start, start + WRITE_BATCH);
        const expected = batch.reduce((total, chunk) => total + chunk.length, 0);
        const { bytesWritten } = await file.writev(batch);
        if (bytesWritten !== expected)
          throw new Error(`Short write to ${tempPath}: ${bytesWritten} of ${expected} bytes`);
      }
    } finally {
      await file.close();
    }
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== "ENOENT") console.warn(`[quest-store] Could not remove ${tempPath}:`, cleanupError);
    });
    throw error;
  }
}

function serializedQuest(quest: object): Buffer {
  const cached = questBytes.get(quest);
  if (cached) return cached;
  // Raw newlines only appear between JSON tokens (string newlines are escaped),
  // so re-indenting them nests the quest's lines inside the array.
  const bytes = Buffer.from(JSON.stringify(quest, null, 2).replaceAll("\n", `\n${QUEST_INDENT}`));
  if (Object.isFrozen(quest)) questBytes.set(quest, bytes);
  return bytes;
}
