import { Hono, type Context } from "hono";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSettings } from "../settings-manager.js";
import {
  CUSTOM_NOTIFICATION_SOUND_SLOTS,
  MAX_CUSTOM_NOTIFICATION_SOUND_BYTES,
  isCustomNotificationSoundSlot,
  type CustomNotificationSoundInfo,
  type CustomNotificationSoundList,
  type CustomNotificationSoundSlot,
} from "../../shared/custom-notification-sounds.js";

/**
 * The user's own alert sounds for the Custom sound set. They are kept once on
 * the server, under ~/.companion/notification-sounds/<server>/ by default, and
 * every browser plays them from here; which set a device plays stays a
 * per-device choice in the browser.
 *
 * Each slot is two files: `<slot>.audio` (the bytes as uploaded) and
 * `<slot>.json` (its CustomNotificationSoundInfo).
 */
export function createNotificationSoundRoutes(root: () => string = defaultNotificationSoundRoot) {
  const api = new Hono();

  api.get("/notification-sounds", async (c) => {
    const entries = await Promise.all(
      CUSTOM_NOTIFICATION_SOUND_SLOTS.map(async (slot) => [slot, await readInfo(root(), slot)] as const),
    );
    return c.json(Object.fromEntries(entries) as CustomNotificationSoundList);
  });

  api.get("/notification-sounds/:slot/audio", async (c) => {
    const slot = c.req.param("slot");
    if (!isCustomNotificationSoundSlot(slot)) return c.json({ error: "Unknown sound" }, 404);
    const info = await readInfo(root(), slot);
    if (!info) return c.json({ error: "No custom sound uploaded" }, 404);
    const etag = `"${info.updatedAt}-${info.size}"`;
    // Browsers revalidate before each alert, so a changed upload plays everywhere on the next alert.
    const headers = { ETag: etag, "Cache-Control": "no-cache" };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    const bytes = await readFile(join(root(), `${slot}.audio`)).catch(() => null);
    if (!bytes) return c.json({ error: "No custom sound uploaded" }, 404);
    return c.body(new Uint8Array(bytes), 200, { ...headers, "Content-Type": info.mimeType });
  });

  // The body is the raw file; its name comes in X-File-Name (URI-encoded).
  api.put("/notification-sounds/:slot", async (c) => {
    const slot = c.req.param("slot");
    if (!isCustomNotificationSoundSlot(slot)) return c.json({ error: "Unknown sound" }, 404);
    const mimeType = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!mimeType.startsWith("audio/")) return c.json({ error: "Choose an audio file" }, 415);
    if (Number(c.req.header("content-length") ?? 0) > MAX_CUSTOM_NOTIFICATION_SOUND_BYTES) return tooLarge(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) return c.json({ error: "The file is empty" }, 400);
    if (bytes.byteLength > MAX_CUSTOM_NOTIFICATION_SOUND_BYTES) return tooLarge(c);
    const info: CustomNotificationSoundInfo = {
      name: decodeFileName(c.req.header("x-file-name")) || `${slot} sound`,
      mimeType,
      size: bytes.byteLength,
      updatedAt: Date.now(),
    };
    await saveSound(root(), slot, info, bytes);
    return c.json(info);
  });

  api.delete("/notification-sounds/:slot", async (c) => {
    const slot = c.req.param("slot");
    if (!isCustomNotificationSoundSlot(slot)) return c.json({ error: "Unknown sound" }, 404);
    await rm(join(root(), `${slot}.json`), { force: true });
    await rm(join(root(), `${slot}.audio`), { force: true });
    return c.json({ ok: true });
  });

  return api;
}

function defaultNotificationSoundRoot(): string {
  const serverSlug = (getSettings().serverSlug || "local").replace(/[^A-Za-z0-9._-]/g, "_");
  return join(homedir(), ".companion", "notification-sounds", serverSlug);
}

async function readInfo(root: string, slot: CustomNotificationSoundSlot): Promise<CustomNotificationSoundInfo | null> {
  const text = await readFile(join(root, `${slot}.json`), "utf-8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text) as CustomNotificationSoundInfo;
  } catch (err) {
    console.warn(`[notification-sounds] Ignoring unreadable ${slot}.json:`, err);
    return null;
  }
}

/** Writes the audio before its info, each through a rename, so a listed sound always has complete bytes. */
async function saveSound(
  root: string,
  slot: CustomNotificationSoundSlot,
  info: CustomNotificationSoundInfo,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${slot}.audio.tmp`), bytes);
  await rename(join(root, `${slot}.audio.tmp`), join(root, `${slot}.audio`));
  await writeFile(join(root, `${slot}.json.tmp`), JSON.stringify(info, null, 2));
  await rename(join(root, `${slot}.json.tmp`), join(root, `${slot}.json`));
}

function decodeFileName(header: string | undefined): string {
  if (!header) return "";
  try {
    return decodeURIComponent(header).slice(0, 200);
  } catch {
    return header.slice(0, 200);
  }
}

function tooLarge(c: Context): Response {
  const limitMb = MAX_CUSTOM_NOTIFICATION_SOUND_BYTES / (1024 * 1024);
  return c.json({ error: `Alert sounds can be at most ${limitMb} MB` }, 413);
}
