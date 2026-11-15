import { useSyncExternalStore } from "react";
import { setLocalStorageItem } from "../utils/scoped-storage.js";

/**
 * Temporary preview switch for trying rich-text composer boxes side by side with today's
 * textarea: "textarea" (today), "rich-plain" (a rich-text box that behaves like the textarea) or
 * "rich-markdown" (basic Markdown drawn as you type). Kept per browser.
 */
export type ComposerTextBoxMode = "textarea" | "rich-plain" | "rich-markdown";

const KEY = "cc-composer-text-box-preview";
const listeners = new Set<() => void>();

function read(): ComposerTextBoxMode {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  return stored === "rich-plain" || stored === "rich-markdown" ? stored : "textarea";
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
