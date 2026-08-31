import { scopedGetItem, scopedRemoveItem } from "./scoped-storage.js";
import { normalizeLeaderOpenThreadKeys } from "../../shared/leader-open-thread-tabs.js";

export const MAX_OPEN_THREAD_TAB_STORAGE_CHARS = 16 * 1024;

/**
 * Legacy browser-storage migration helper for leader thread tabs.
 *
 * Leader open-tab set/order is server-owned workflow state. This module only
 * reads and clears older localStorage state for one-time migration.
 */
function openThreadTabsKey(sessionId: string): string {
  return `cc-leader-open-thread-tabs:${sessionId}`;
}

export function readOpenThreadTabKeys(sessionId: string): string[] {
  if (typeof window === "undefined") return [];
  const raw = readStoredOpenThreadTabs(sessionId);
  if (!raw) return [];
  if (raw.length > MAX_OPEN_THREAD_TAB_STORAGE_CHARS) {
    warnOpenThreadTabStorage("Ignoring oversized leader open thread tabs storage.", {
      length: raw.length,
      maxLength: MAX_OPEN_THREAD_TAB_STORAGE_CHARS,
    });
    return [];
  }
  try {
    return normalizeLeaderOpenThreadKeys(openThreadTabValuesFromParsed(JSON.parse(raw)));
  } catch (error) {
    warnOpenThreadTabStorage("Ignoring invalid leader open thread tabs storage.", error);
    return [];
  }
}

export function clearOpenThreadTabKeys(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    scopedRemoveItem(openThreadTabsKey(sessionId));
  } catch (error) {
    warnOpenThreadTabStorage("Could not clear migrated leader open thread tabs storage.", error);
  }
}

function readStoredOpenThreadTabs(sessionId: string): string | null {
  try {
    return scopedGetItem(openThreadTabsKey(sessionId));
  } catch (error) {
    warnOpenThreadTabStorage("Could not read leader open thread tabs storage.", error);
    return null;
  }
}

function openThreadTabValuesFromParsed(parsed: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  for (const key of ["threadKeys", "openThreadTabKeys", "tabs", "openTabs"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function warnOpenThreadTabStorage(message: string, error: unknown): void {
  console.warn(`[takode] ${message}`, error);
}
