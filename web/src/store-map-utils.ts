import { scopedSetItem } from "./utils/scoped-storage.js";

const MAX_SIDE_PANEL_STORAGE_ITEMS = 500;
const MAX_SIDE_PANEL_STORAGE_CHARS = 20_000;

export function withMapEntry<K, V>(source: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(source);
  next.set(key, value);
  return next;
}

export function withOptionalMapEntry<K, V>(source: ReadonlyMap<K, V>, key: K, value: V | null): Map<K, V> {
  const next = new Map(source);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function persistSidePanelStringSet(storageKey: string, values: Set<string>): void {
  if (typeof window === "undefined") return;
  let boundedValues = Array.from(values).slice(-MAX_SIDE_PANEL_STORAGE_ITEMS);
  let serialized = JSON.stringify(boundedValues);
  while (serialized.length > MAX_SIDE_PANEL_STORAGE_CHARS && boundedValues.length > 0) {
    boundedValues = boundedValues.slice(1);
    serialized = JSON.stringify(boundedValues);
  }
  try {
    scopedSetItem(storageKey, serialized);
  } catch (error) {
    console.warn("[takode] Could not persist side panel state; continuing in memory.", error);
  }
}
