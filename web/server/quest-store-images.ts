import { randomBytes } from "node:crypto";
import { readdir, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  buildStoredImageFilename,
  isTakodeAgentOptimizedPath,
  MIME_TO_EXT,
  optimizeImageBufferForStore,
  wasImageBufferProcessed,
} from "./image-optimizer.js";
import { backupQuestImageFile } from "./quest-backup-store.js";
import type { QuestImage, QuestmasterTask } from "./quest-types.js";

type QuestImageStoreDeps<TStore> = {
  getLiveQuestById: (store: TStore, questId: string) => QuestmasterTask | null;
  liveQuestmasterDir: string;
  mutateLiveQuestStore: <T>(
    fn: (
      store: TStore,
    ) => Promise<{ store: TStore; result: T; write?: boolean }> | { store: TStore; result: T; write?: boolean },
  ) => Promise<T>;
  normalizeLiveQuest: (quest: QuestmasterTask) => QuestmasterTask;
  upsertLiveQuest: (store: TStore, quest: QuestmasterTask) => TStore;
};

const QUEST_EXT_TO_MIME = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mimeType, ext]) => [`.${ext}`, mimeType]),
);
QUEST_EXT_TO_MIME[".jpg"] = "image/jpeg";

export async function saveQuestImageFile(args: {
  data: Buffer;
  ensureLiveImagesDir: () => Promise<void>;
  filename: string;
  liveImagesDir: string;
  mimeType: string;
}): Promise<QuestImage> {
  await args.ensureLiveImagesDir();
  const id = randomBytes(8).toString("hex");
  const alreadyOptimized = isTakodeAgentOptimizedPath(args.filename);
  const optimized = alreadyOptimized
    ? { data: args.data, mediaType: args.mimeType, resized: false, reencoded: false }
    : await optimizeImageBufferForStore(args.data, args.mimeType);
  const diskName = buildStoredImageFilename(id, optimized.mediaType, {
    optimized: alreadyOptimized || wasImageBufferProcessed(optimized),
  });
  const diskPath = join(args.liveImagesDir, diskName);
  await writeFile(diskPath, optimized.data);
  const image = { id, filename: args.filename, mimeType: optimized.mediaType, path: diskPath };
  await backupQuestImageFile(image).catch((error) => {
    console.warn("[quest-backup] Failed to back up quest image:", error);
  });
  return image;
}

export async function addQuestImagesToStore<TStore>(
  questId: string,
  images: QuestImage[],
  deps: QuestImageStoreDeps<TStore>,
): Promise<QuestmasterTask | null> {
  return deps.mutateLiveQuestStore(async (store) => {
    const current = deps.getLiveQuestById(store, questId);
    if (!current) return { store, result: null, write: false };

    const existing = current.images ?? [];
    const updated = {
      ...current,
      images: [...existing, ...images],
      updatedAt: Date.now(),
    } as QuestmasterTask;
    return { store: deps.upsertLiveQuest(store, updated), result: deps.normalizeLiveQuest(updated) };
  });
}

export async function removeQuestImageFromStore<TStore>(
  questId: string,
  imageId: string,
  deps: QuestImageStoreDeps<TStore>,
): Promise<QuestmasterTask | null> {
  const result = await deps.mutateLiveQuestStore(async (store) => {
    const current = deps.getLiveQuestById(store, questId);
    if (!current) {
      return {
        store,
        result: { quest: null as QuestmasterTask | null, imagePath: undefined as string | undefined },
        write: false,
      };
    }
    if (!current.images?.length) return { store, result: { quest: current, imagePath: undefined }, write: false };

    const image = current.images.find((img) => img.id === imageId);
    const updated = {
      ...current,
      images: current.images.filter((img) => img.id !== imageId),
      updatedAt: Date.now(),
    } as QuestmasterTask;
    return {
      store: deps.upsertLiveQuest(store, updated),
      result: { quest: deps.normalizeLiveQuest(updated), imagePath: image?.path },
    };
  });

  if (result.imagePath && isManagedLiveQuestPath(result.imagePath, deps.liveQuestmasterDir)) {
    await backupQuestImageFile({
      filename: imageId,
      mimeType: "application/octet-stream",
      path: result.imagePath,
    }).catch(() => {});
    await unlink(result.imagePath).catch(() => {});
  }
  return result.quest;
}

export async function readQuestImageFileFromDirs(
  imageId: string,
  imageDirs: string[],
): Promise<{ data: Buffer; mimeType: string } | null> {
  for (const imageDir of imageDirs) {
    try {
      await mkdir(imageDir, { recursive: true });
      const files = await readdir(imageDir);
      const file = files.find((f) => f.startsWith(imageId));
      if (!file) continue;
      const fullPath = join(imageDir, file);
      const data = (await readFile(fullPath)) as Buffer;
      const ext = extname(file).toLowerCase();
      const mimeType = QUEST_EXT_TO_MIME[ext] ?? "application/octet-stream";
      return { data, mimeType };
    } catch {
      // Try the next known image directory.
    }
  }
  return null;
}

function isManagedLiveQuestPath(path: string, liveQuestmasterDir: string): boolean {
  return path === liveQuestmasterDir || path.startsWith(`${liveQuestmasterDir}/`);
}
