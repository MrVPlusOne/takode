import { scopedGetItem, scopedRemoveItem, scopedSetItem } from "./scoped-storage.js";
import {
  MAX_LEADER_OPEN_THREAD_TABS,
  normalizeLeaderOpenThreadKeys,
  placeLeaderOpenThreadTabKey,
  shouldPersistLeaderThreadTab,
} from "../../shared/leader-open-thread-tabs.js";

export const MAX_OPEN_THREAD_TAB_KEYS = MAX_LEADER_OPEN_THREAD_TABS;
export const MAX_OPEN_THREAD_TAB_STORAGE_CHARS = 16 * 1024;

/**
 * Legacy browser-storage migration helper for leader thread tabs.
 *
 * Leader open-tab set/order is server-owned workflow state. This module only
 * reads older localStorage state for one-time migration and keeps the previous
 * non-throwing write helpers for compatibility tests/recovery paths.
 */
export function openThreadTabsKey(sessionId: string): string {
  return `cc-leader-open-thread-tabs:${sessionId}`;
}

export function shouldPersistOpenThreadTab(threadKey: string): boolean {
  return shouldPersistLeaderThreadTab(threadKey);
}

export function normalizeOpenThreadTabKeys(threadKeys: ReadonlyArray<unknown>): string[] {
  return normalizeLeaderOpenThreadKeys(threadKeys);
}

export function placeOpenThreadTabKey(
  existingThreadKeys: ReadonlyArray<string>,
  threadKey: string,
  placement: "first" | "last",
): string[] {
  return placeLeaderOpenThreadTabKey(existingThreadKeys, threadKey, placement);
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
    return normalizeOpenThreadTabKeys(openThreadTabValuesFromParsed(JSON.parse(raw)));
  } catch (error) {
    warnOpenThreadTabStorage("Ignoring invalid leader open thread tabs storage.", error);
    return [];
  }
}

export function persistOpenThreadTabKeys(sessionId: string, threadKeys: ReadonlyArray<string>): boolean {
  if (typeof window === "undefined") return false;
  const storageKey = openThreadTabsKey(sessionId);
  const payload = JSON.stringify(normalizeOpenThreadTabKeys(threadKeys));
  try {
    scopedSetItem(storageKey, payload);
    return true;
  } catch (error) {
    warnOpenThreadTabStorage("Retrying leader open thread tabs storage after write failure.", error);
  }

  try {
    scopedRemoveItem(storageKey);
    scopedSetItem(storageKey, payload);
    return true;
  } catch (error) {
    warnOpenThreadTabStorage("Could not persist leader open thread tabs; continuing in memory.", error);
    return false;
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
