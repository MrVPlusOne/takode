import { scopedGetItem, scopedRemoveItem, scopedSetItem, setLocalStorageItem } from "./scoped-storage.js";

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

/**
 * Earlier builds remembered pasted images' data URLs here, which filled the browser's storage, and
 * while it is full no other preference (such as a folded section) can be saved. Drops them from
 * every server's entry once at startup, before anything else needs the space; the rest of the list
 * stays.
 */
export function purgeStoredDataThumbnails(): void {
  if (typeof localStorage === "undefined") return;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === STORAGE_KEY || key?.endsWith(`:${STORAGE_KEY}`)) keys.push(key);
  }
  for (const key of keys) {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      const urls = Array.isArray(stored) ? stored : [];
      const kept = urls.filter((url): url is string => typeof url === "string" && isRememberable(url));
      if (kept.length === urls.length && Array.isArray(stored)) continue;
      // Remove first, so the smaller list fits even when storage is full.
      localStorage.removeItem(key);
      if (kept.length) setLocalStorageItem(key, JSON.stringify(kept));
    } catch (error) {
      console.warn(`[thumbnails] Could not clean ${key}:`, error);
    }
  }
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
