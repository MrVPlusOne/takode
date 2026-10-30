/**
 * Keyboard shortcut settings, saved by the server and edited in Settings. Both sides read
 * them through this module so a new action is accepted everywhere at once: the server drops
 * overrides for actions it doesn't know, which once silently reverted every change to a
 * newly added action.
 */

/** Every shortcut action, in the order matching checks them. */
export const SHORTCUT_ACTION_IDS = [
  "search_session",
  "toggle_sidebar",
  "open_terminal",
  "previous_session",
  "next_session",
  "next_attention",
  "next_attention_global",
  "new_session",
  "voice_start",
  "voice_stop",
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

export const SHORTCUT_PRESET_IDS = ["standard", "vscode-light", "vim-light"] as const;

export type ShortcutPresetId = (typeof SHORTCUT_PRESET_IDS)[number];

/** A key combination such as "Mod+Shift+E", or a tap gesture such as "DoubleTap:Shift". */
export type ShortcutBinding = string;

/**
 * The key held while clicking to open something in a leader's side column instead of in place.
 * Cmd/Ctrl-click opens it in a window of its own, as in browsers, so it isn't offered here (a saved
 * "mod" from before reads as the default).
 */
export type OpenInSideModifier = "shift" | "alt";
const OPEN_IN_SIDE_MODIFIERS = new Set<string>(["shift", "alt"] satisfies OpenInSideModifier[]);

export interface ShortcutSettings {
  enabled: boolean;
  preset: ShortcutPresetId;
  /** Per-action bindings that replace the preset's; null turns the action's shortcut off. */
  overrides: Partial<Record<ShortcutActionId, ShortcutBinding | null>>;
  /**
   * Typing a character with nothing else focused opens the collapsed composer with it. Independent
   * of `enabled`: it binds no key of its own, so it stays on while the shortcut presets are off.
   */
  typeToCompose: boolean;
  /**
   * Clicking a quest, topic, artifact or report with this key held opens it in the leader's side
   * column. Independent of `enabled`, like `typeToCompose`.
   */
  openInSideModifier: OpenInSideModifier;
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  enabled: false,
  preset: "standard",
  overrides: {},
  typeToCompose: true,
  openInSideModifier: "shift",
};

const ACTION_ID_SET = new Set<string>(SHORTCUT_ACTION_IDS);
const PRESET_ID_SET = new Set<string>(SHORTCUT_PRESET_IDS);

/**
 * Reads shortcut settings from untrusted JSON, keeping only known actions and string or null
 * bindings. Returns undefined when `raw` is not an object, so callers can tell "none saved".
 */
export function parseShortcutSettings(raw: unknown): ShortcutSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  const rawOverrides =
    candidate.overrides && typeof candidate.overrides === "object" && !Array.isArray(candidate.overrides)
      ? (candidate.overrides as Record<string, unknown>)
      : {};
  const overrides: ShortcutSettings["overrides"] = {};
  for (const [actionId, binding] of Object.entries(rawOverrides)) {
    if (!ACTION_ID_SET.has(actionId)) continue;
    if (binding === null || typeof binding === "string") {
      overrides[actionId as ShortcutActionId] = binding;
    }
  }

  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_SHORTCUT_SETTINGS.enabled,
    preset: PRESET_ID_SET.has(candidate.preset as string)
      ? (candidate.preset as ShortcutPresetId)
      : DEFAULT_SHORTCUT_SETTINGS.preset,
    overrides,
    typeToCompose:
      typeof candidate.typeToCompose === "boolean" ? candidate.typeToCompose : DEFAULT_SHORTCUT_SETTINGS.typeToCompose,
    openInSideModifier: OPEN_IN_SIDE_MODIFIERS.has(candidate.openInSideModifier as string)
      ? (candidate.openInSideModifier as OpenInSideModifier)
      : DEFAULT_SHORTCUT_SETTINGS.openInSideModifier,
  };
}
