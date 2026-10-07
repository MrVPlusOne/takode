import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SendKeyScheme } from "../../shared/send-key-scheme.js";
import { platformIsMac } from "../shortcuts.js";
import { useStore } from "../store.js";
import { isTouchDevice } from "../utils/mobile.js";

type SendKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "isComposing" | "keyCode">;

interface SendKeyEnvironment {
  /** On-screen keyboards keep Enter as a newline; users tap the send/save button instead. */
  touchKeyboard: boolean;
  platform?: string;
}

/**
 * Whether a keydown in a multi-line send/save text box should send or save instead of inserting a newline.
 * Cmd+Enter (Ctrl+Enter off Mac; either modifier is accepted everywhere) sends under both schemes, so a
 * hardware keyboard on a touch device can still send. Enter that confirms an IME candidate never sends;
 * keyCode 229 covers browsers that do not report `isComposing`.
 */
export function isSendKeyEvent(event: SendKeyEvent, scheme: SendKeyScheme, env: SendKeyEnvironment): boolean {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return false;
  if (event.metaKey || event.ctrlKey) return true;
  return scheme !== "mod-enter" && !env.touchKeyboard && !event.shiftKey;
}

/** Tooltip/hint text describing the active keys, e.g. "Send: Enter; New line: Shift+Enter". */
export function sendKeyHint(scheme: SendKeyScheme, env: SendKeyEnvironment, action: "Send" | "Save" = "Send"): string {
  if (env.touchKeyboard) return `${action}: tap button; New line: Enter`;
  if (scheme === "mod-enter") return `${action}: ${platformIsMac(env.platform) ? "⌘" : "Ctrl"}+Enter; New line: Enter`;
  return `${action}: Enter; New line: Shift+Enter`;
}

/**
 * The user's send-key scheme for multi-line send/save boxes (composer, comments, quick replies).
 * `isSendKey` decides whether a keydown should send/save; callers then `preventDefault()` and act.
 */
export function useSendKey(action: "Send" | "Save" = "Send") {
  const scheme = useStore((s) => s.sendKeyScheme);
  const env: SendKeyEnvironment = {
    touchKeyboard: isTouchDevice(),
    platform: typeof navigator === "undefined" ? undefined : navigator.platform,
  };
  return {
    isSendKey: (event: ReactKeyboardEvent) => isSendKeyEvent(event.nativeEvent, scheme, env),
    hint: sendKeyHint(scheme, env, action),
  };
}
