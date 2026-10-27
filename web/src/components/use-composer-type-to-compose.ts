import { useEffect, type RefObject } from "react";
import { isShortcutEventTargetEditable, platformIsMac } from "../shortcuts.js";

/** What a keystroke made outside any input does to the composer. */
export type TypeToComposeKey = "character" | "paste" | "enter";

/** Open surfaces that own the keyboard: while one is up, typing belongs to it, not the composer behind it. */
const KEYBOARD_OWNER_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-modal-backdrop]",
  "[data-context-menu]",
].join(",");

/** Focused widgets that use typed characters themselves, such as menu typeahead or radio and slider keys. */
const KEY_CONSUMING_WIDGET_SELECTOR = [
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="tree"]',
  '[role="treegrid"]',
  '[role="grid"]',
  '[role="radiogroup"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(",");

/** Focused elements that Enter activates, so Enter stays theirs. */
const ENTER_ACTIVATED_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(",");

/**
 * Which type-to-compose key an event is, or null for keys the page keeps: navigation keys
 * (arrows, Space, Page Up/Down, Home/End, Tab), Escape, and shortcuts with Cmd, Ctrl or Option,
 * except the platform's paste shortcut.
 */
export function typeToComposeKey(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing">,
  isMac: boolean,
): TypeToComposeKey | null {
  if (event.isComposing) return null;
  const modKey = isMac ? event.metaKey : event.ctrlKey;
  const otherModKey = isMac ? event.ctrlKey : event.metaKey;
  if (modKey && !otherModKey && !event.altKey && event.key.toLowerCase() === "v") return "paste";
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "Enter") return event.shiftKey ? null : "enter";
  // One character, counting an emoji or other astral character as one; Space scrolls the page.
  if (event.key !== " " && [...event.key].length === 1) return "character";
  return null;
}

/**
 * Typing with nothing else focused opens the composer: a character or a paste lands in it, and
 * Enter opens it empty. The key goes to the composer only when no other input, menu, dialog or
 * viewer is using the keyboard, no text is selected, and the composer is on screen and usable.
 *
 * For characters and paste the textarea is focused during keydown and the browser then delivers
 * the key itself to the new focus, so typing, paste (images included) and the composer's own
 * input handling all work as if the user had clicked first. Enter's default is stopped instead,
 * since it would otherwise add a new line to the draft.
 */
export function useComposerTypeToCompose({
  textareaRef,
  enabled,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  enabled: boolean;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const isMac = platformIsMac(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = typeToComposeKey(event, isMac);
      const textarea = textareaRef.current;
      if (!key || !textarea || !canTypeToCompose(event.target, key, textarea)) return;
      if (key === "enter") event.preventDefault();
      textarea.focus({ preventScroll: true });
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    };
    // Bubble phase, so app shortcuts and open surfaces, which listen in the capture phase or on
    // their own elements, can claim a key first by stopping or preventing it.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, textareaRef]);
}

function canTypeToCompose(target: EventTarget | null, key: TypeToComposeKey, textarea: HTMLTextAreaElement): boolean {
  if (textarea.disabled || textarea.readOnly || textarea.closest("[inert]")) return false;
  if (isShortcutEventTargetEditable(target)) return false;
  if (target instanceof Element) {
    if (target.closest(KEY_CONSUMING_WIDGET_SELECTOR)) return false;
    if (key === "enter" && target.closest(ENTER_ACTIVATED_SELECTOR)) return false;
  }
  const doc = textarea.ownerDocument;
  // A selection is waiting for a comment or a copy; typing must not drop it.
  const selection = doc.getSelection();
  if (selection && !selection.isCollapsed) return false;
  return !Array.from(doc.querySelectorAll(KEYBOARD_OWNER_SELECTOR)).some(isShown);
}

function isShown(element: Element): boolean {
  // A kept, hidden view can hold an open surface; only one on screen owns the keyboard.
  return typeof element.checkVisibility === "function" ? element.checkVisibility() : true;
}
