import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { saveQuestImage } from "../server/quest-store.js";
import type { QuestImage } from "../server/quest-types.js";

/** Upload a CLI image through the live Takode server. */
export async function uploadQuestInputImage(
  port: string,
  rawPath: string,
  headers: Record<string, string>,
): Promise<QuestImage> {
  const filePath = resolve(rawPath);
  const data = await readFile(filePath);
  const form = new FormData();
  form.set("file", new File([data], basename(filePath), { type: guessMimeType(filePath) }));
  const response = await fetch(`http://localhost:${port}/api/quests/_images`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((error as { error?: string }).error || response.statusText);
  }
  return (await response.json()) as QuestImage;
}

/** Save a CLI image in the local Quest store during server-side command execution. */
export async function saveQuestInputImage(rawPath: string): Promise<QuestImage> {
  const filePath = resolve(rawPath);
  return saveQuestImage(basename(filePath), await readFile(filePath), guessMimeType(filePath));
}

function guessMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
