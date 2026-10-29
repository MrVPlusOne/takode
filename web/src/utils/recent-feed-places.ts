import { scopedGetItem, scopedSetItem } from "./scoped-storage.js";

/**
 * The conversations (feed viewport keys: a chat, a leader's tab or a topic conversation) this
 * browser showed, most recent first. A place among the last few left keeps its reading position
 * however long ago it was left, like the chats kept loaded; see `restorableViewportPosition`.
 */
export const RECENT_FEED_PLACE_COUNT = 3;

const STORAGE_KEY = "cc-recent-feed-places";
const MAX_ENTRIES = 10;

let places: string[] | null = null;

/** Record that a feed is on screen. */
export function noteFeedPlaceShown(viewportKey: string): void {
  const current = recentFeedPlaces();
  if (current[0] === viewportKey) return;
  places = [viewportKey, ...current.filter((key) => key !== viewportKey)].slice(0, MAX_ENTRIES);
  try {
    scopedSetItem(STORAGE_KEY, JSON.stringify(places));
  } catch (error) {
    console.warn("[recent-feed-places] failed to save:", error);
  }
}

/**
 * Whether a feed about to open is one of the last places left. Called before the feed records
 * itself, so the first entry is the place being left (or, after a reload, this same place).
 */
export function isRecentFeedPlace(viewportKey: string): boolean {
  return recentFeedPlaces().slice(0, RECENT_FEED_PLACE_COUNT).includes(viewportKey);
}

/** Forget the in-memory copy so the next read loads storage again. For tests. */
export function resetRecentFeedPlacesForTest(): void {
  places = null;
}

function recentFeedPlaces(): string[] {
  places ??= load();
  return places;
}

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(scopedGetItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch (error) {
    console.warn("[recent-feed-places] ignoring unreadable saved places:", error);
    return [];
  }
}
