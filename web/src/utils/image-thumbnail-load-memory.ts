import { scopedGetItem, scopedRemoveItem, scopedSetItem } from "./scoped-storage.js";

const STORAGE_KEY = "cc-loaded-image-thumbnails";
const MAX_REMEMBERED = 500;
const SAVE_DELAY_MS = 1_000;

let loaded: Set<string> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Thumbnail URLs this browser has already loaded. A preview group remounts on
 * every thread open; without this, an image mentioned only by path hides until
 * it loads again and then pushes the messages below it down.
 */
export function wasThumbnailLoaded(url: string): boolean {
  return remembered().has(url);
}

export function rememberThumbnailLoaded(url: string): void {
  if (!isRememberable(url)) return;
  const urls = remembered();
  // Re-insert so the set stays ordered from least to most recently loaded.
  urls.delete(url);
  urls.add(url);
  if (urls.size > MAX_REMEMBERED) urls.delete(urls.values().next().value as string);
  scheduleSave();
}

export function forgetThumbnailLoaded(url: string): void {
  if (remembered().delete(url)) scheduleSave();
}

export function resetThumbnailLoadMemoryForTest(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  loaded = null;
  if (typeof localStorage !== "undefined") scopedRemoveItem(STORAGE_KEY);
}

/**
 * Blob and data URLs are local: they show at once without loading, so there is
 * nothing to remember. A data URL also holds the whole image, and a few pasted
 * screenshots would fill the browser's storage quota.
 */
function isRememberable(url: string): boolean {
  return !url.startsWith("blob:") && !url.startsWith("data:");
}

function remembered(): Set<string> {
  if (loaded) return loaded;
  loaded = new Set();
  let dropped = false;
  try {
    const stored: unknown = JSON.parse(scopedGetItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return loaded;
    for (const url of stored) {
      if (typeof url !== "string") continue;
      if (isRememberable(url)) loaded.add(url);
      else dropped = true;
    }
  } catch {
    // A corrupt entry only costs one reload of each thumbnail.
  }
  // Earlier builds stored data URLs; rewrite without them to give the space back.
  if (dropped) scheduleSave();
  return loaded;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      scopedSetItem(STORAGE_KEY, JSON.stringify([...remembered()]));
    } catch {
      // Storage full or unavailable: the in-memory set still serves this page.
    }
  }, SAVE_DELAY_MS);
}
