import { useSyncExternalStore } from "react";
import { setLocalStorageItem } from "../utils/scoped-storage.js";

/**
 * Which text box chat inputs use, kept per browser: the Markdown box, which draws basic Markdown
 * and quest and session links as you type (the default), or a plain textarea.
 */
export type ChatTextBoxMode = "markdown" | "plain";

const KEY = "cc-chat-text-box";
/** Where the setting lived while it was a preview; "textarea" there was an explicit choice of plain. */
const PREVIEW_KEY = "cc-composer-text-box-preview";
const listeners = new Set<() => void>();
let unchosen: ChatTextBoxMode = "markdown";

function read(): ChatTextBoxMode {
  if (typeof localStorage === "undefined") return unchosen;
  const stored = localStorage.getItem(KEY);
  if (stored === "markdown" || stored === "plain") return stored;
  return localStorage.getItem(PREVIEW_KEY) === "textarea" ? "plain" : unchosen;
}

/**
 * Sets the mode of a browser that never chose one. Tests use it: jsdom cannot edit a
 * `contenteditable` element the way a browser does, so tests that drive chat inputs by typing run
 * on the plain textarea unless they choose the Markdown box.
 */
export function setUnchosenChatTextBoxModeForTest(mode: ChatTextBoxMode): void {
  unchosen = mode;
}

export function setChatTextBoxMode(mode: ChatTextBoxMode): void {
  setLocalStorageItem(KEY, mode);
  for (const listener of listeners) listener();
}

export function useChatTextBoxMode(): ChatTextBoxMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => "markdown",
  );
}
