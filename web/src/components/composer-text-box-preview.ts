import { useSyncExternalStore } from "react";
import { setLocalStorageItem } from "../utils/scoped-storage.js";

/**
 * Temporary preview switch between today's textarea ("textarea") and the rich-text box that draws
 * basic Markdown as you type ("rich-markdown"). Kept per browser.
 */
export type ComposerTextBoxMode = "textarea" | "rich-markdown";

const KEY = "cc-composer-text-box-preview";
const listeners = new Set<() => void>();

function read(): ComposerTextBoxMode {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  return stored === "rich-markdown" ? stored : "textarea";
}

export function setComposerTextBoxMode(mode: ComposerTextBoxMode): void {
  setLocalStorageItem(KEY, mode);
  for (const listener of listeners) listener();
}

export function useComposerTextBoxMode(): ComposerTextBoxMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => "textarea",
  );
}
