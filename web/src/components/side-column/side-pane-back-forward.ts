import { useEffect } from "react";
import { platformIsMac } from "../../shortcuts.js";
import { focusedChat, sideItemOfChat } from "../../utils/chat-focus.js";
import { goSidePane } from "../../utils/side-column.js";

/**
 * The browser's Back and Forward act on the focused side pane, not the main view (Jiayi, Nov 16):
 * while a pane of the side column is the focused chat, they step through what that pane showed
 * (`goSidePane`). The browser never gets them then, even when the pane has nowhere to go, so the main
 * view never moves under a focused pane. The browser's own buttons and swipe gestures can't be
 * caught, and stay the main view's.
 */
export function useSidePaneBackForward(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const mac = platformIsMac(navigator.platform);
    const handle = (event: KeyboardEvent | MouseEvent) => {
      if (event.defaultPrevented) return;
      const pane = sideItemOfChat(focusedChat());
      const direction = pane ? backForwardOf(event, mac) : null;
      if (!pane || !direction) return;
      event.preventDefault();
      goSidePane(pane, direction);
    };
    document.addEventListener("keydown", handle);
    // Browsers go back or forward on a mouse's side buttons when they are released.
    document.addEventListener("mouseup", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      document.removeEventListener("mouseup", handle);
    };
  }, [enabled]);
}

/**
 * Which way a key press or mouse button is the browser's Back or Forward: Cmd+[ and Cmd+] on a Mac,
 * and Cmd+Left and Cmd+Right outside text (in text they move to the line's ends); Alt+Left and
 * Alt+Right elsewhere; a mouse's back and forward buttons. Null for anything else.
 */
export function backForwardOf(event: KeyboardEvent | MouseEvent, mac: boolean): "back" | "forward" | null {
  if (!("key" in event)) return event.button === 3 ? "back" : event.button === 4 ? "forward" : null;
  const { key, metaKey, altKey, ctrlKey, shiftKey } = event;
  if (shiftKey || ctrlKey) return null;
  if (mac) {
    if (!metaKey || altKey) return null;
    if (key === "[") return "back";
    if (key === "]") return "forward";
    if (isTextTarget(event.target)) return null;
    return key === "ArrowLeft" ? "back" : key === "ArrowRight" ? "forward" : null;
  }
  if (!altKey || metaKey) return null;
  return key === "ArrowLeft" ? "back" : key === "ArrowRight" ? "forward" : null;
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
