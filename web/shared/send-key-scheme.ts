/**
 * How multi-line send/save text boxes (composer, comments, quick replies) treat Enter.
 * - `enter`: Enter sends or saves, Shift+Enter inserts a newline.
 * - `mod-enter`: Enter and Shift+Enter insert newlines; Cmd+Enter (Ctrl+Enter off Mac) sends or saves.
 */
export type SendKeyScheme = "enter" | "mod-enter";

export const DEFAULT_SEND_KEY_SCHEME: SendKeyScheme = "enter";

export function isSendKeyScheme(value: unknown): value is SendKeyScheme {
  return value === "enter" || value === "mod-enter";
}

export function normalizeSendKeyScheme(value: unknown): SendKeyScheme {
  return isSendKeyScheme(value) ? value : DEFAULT_SEND_KEY_SCHEME;
}
