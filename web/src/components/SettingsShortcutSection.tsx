import {
  SHORTCUT_ACTIONS,
  SHORTCUT_PRESET_OPTIONS,
  formatShortcut,
  getEffectiveShortcutBinding,
  getShortcutPresetBindings,
  platformIsMac,
  type ShortcutActionId,
  type ShortcutSettings,
} from "../shortcuts.js";
import { useStore } from "../store.js";
import type { SendKeyScheme } from "../../shared/send-key-scheme.js";
import type { OpenInSideModifier } from "../../shared/shortcut-settings.js";
import { SettingsSubsection, SettingsToggle } from "./settings-controls.js";

export function SettingsShortcutSection({
  shortcutSettings,
  setShortcutsEnabled,
  setShortcutPreset,
  setShortcutOverride,
  resetShortcutOverrides,
  recordingShortcutActionId,
  setRecordingShortcutActionId,
  shortcutPlatform,
  shortcutRecordNotice = null,
  hidden = false,
}: {
  shortcutSettings: ShortcutSettings;
  setShortcutsEnabled: (enabled: boolean) => void;
  setShortcutPreset: (preset: ShortcutSettings["preset"]) => void;
  setShortcutOverride: (actionId: ShortcutActionId, binding: string | null | undefined) => void;
  resetShortcutOverrides: () => void;
  recordingShortcutActionId: ShortcutActionId | null;
  setRecordingShortcutActionId: (actionId: ShortcutActionId | null) => void;
  shortcutPlatform?: string;
  /** Why the last recording on a row was not saved, shown under that row. */
  shortcutRecordNotice?: { actionId: ShortcutActionId; message: string } | null;
  hidden?: boolean;
}) {
  const browserShortcutExamples = platformIsMac(shortcutPlatform)
    ? "Cmd+N, Cmd+T and Cmd+W"
    : "Ctrl+N, Ctrl+T and Ctrl+W";
  const shortcutPresetBindings = getShortcutPresetBindings(shortcutSettings.preset);
  const shortcutPresetIsCustom = SHORTCUT_ACTIONS.some(
    (action) =>
      Object.prototype.hasOwnProperty.call(shortcutSettings.overrides, action.id) &&
      shortcutSettings.overrides[action.id] !== shortcutPresetBindings[action.id],
  );

  return (
    <SettingsSubsection
      title="Keyboard Shortcuts"
      description="Off by default. Choose a preset, then optionally override individual actions."
      hidden={hidden}
    >
      <SettingsToggle
        label="Use keyboard shortcuts"
        checked={shortcutSettings.enabled}
        onChange={setShortcutsEnabled}
      />

      {shortcutSettings.enabled ? (
        <>
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="shortcut-preset">
              Preset
            </label>
            <select
              id="shortcut-preset"
              value={shortcutSettings.preset}
              onChange={(e) => setShortcutPreset(e.target.value as ShortcutSettings["preset"])}
              className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
            >
              {SHORTCUT_PRESET_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-cc-muted">
              {SHORTCUT_PRESET_OPTIONS.find((option) => option.id === shortcutSettings.preset)?.description}
            </p>
            {shortcutPresetIsCustom && (
              <p className="mt-1 text-xs text-cc-primary">Individual actions below are overriding this preset.</p>
            )}
          </div>

          <div className="rounded-xl border border-cc-border overflow-hidden">
            {SHORTCUT_ACTIONS.map((action, index) => {
              const effectiveBinding = getEffectiveShortcutBinding(shortcutSettings, action.id);
              const hasOverride = Object.prototype.hasOwnProperty.call(shortcutSettings.overrides, action.id);
              const isOffOverride = shortcutSettings.overrides[action.id] === null;
              const isRecording = recordingShortcutActionId === action.id;
              return (
                <div
                  key={action.id}
                  className={`${index > 0 ? "border-t border-cc-border" : ""} px-3 py-3 bg-cc-hover/30 space-y-2`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-cc-fg">{action.label}</div>
                      <p className="mt-0.5 text-xs text-cc-muted">{action.description}</p>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium ${effectiveBinding ? "text-cc-primary" : "text-cc-muted"}`}
                    >
                      {effectiveBinding ? formatShortcut(effectiveBinding, shortcutPlatform) : "Off"}
                    </span>
                  </div>
                  {isRecording ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-cc-primary/35 bg-cc-primary/10 px-3 py-2 text-xs">
                      <span className="text-cc-primary">
                        Press a shortcut or double-tap a key for {action.label}. Esc cancels. Browser shortcuts such as{" "}
                        {browserShortcutExamples} can't be used.
                      </span>
                      <button
                        type="button"
                        onClick={() => setRecordingShortcutActionId(null)}
                        className="px-2 py-1 rounded bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setRecordingShortcutActionId(action.id)}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                      >
                        {hasOverride ? "Record new shortcut" : "Record shortcut"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShortcutOverride(action.id, null)}
                        disabled={!effectiveBinding}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Off
                      </button>
                      <button
                        type="button"
                        onClick={() => setShortcutOverride(action.id, undefined)}
                        disabled={!hasOverride}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Use preset default
                      </button>
                      {hasOverride && (
                        <span className="text-[11px] text-cc-muted">
                          {isOffOverride ? "Shortcut disabled for this action" : "Custom override active"}
                        </span>
                      )}
                    </div>
                  )}
                  {shortcutRecordNotice?.actionId === action.id && (
                    <p role="alert" className="text-xs text-cc-error">
                      {shortcutRecordNotice.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-cc-muted">
              Hover-enabled controls will show shortcut hints only while shortcuts are on.
            </p>
            <button
              type="button"
              onClick={resetShortcutOverrides}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
            >
              Reset Overrides
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-cc-muted">Enable shortcuts to edit presets and bindings.</p>
      )}
    </SettingsSubsection>
  );
}

/** Send-key scheme for multi-line send/save boxes. Always active, independent of the keyboard shortcut toggle. */
export function SendKeySchemeSetting({
  shortcutPlatform,
  hidden = false,
}: {
  shortcutPlatform?: string;
  hidden?: boolean;
}) {
  const sendKeyScheme = useStore((s) => s.sendKeyScheme);
  const setSendKeyScheme = useStore((s) => s.setSendKeyScheme);
  const modEnter = platformIsMac(shortcutPlatform) ? "⌘+Enter" : "Ctrl+Enter";
  return (
    <div hidden={hidden}>
      <label className="block text-sm font-medium mb-1.5" htmlFor="send-key-scheme">
        Send Key
      </label>
      <select
        id="send-key-scheme"
        value={sendKeyScheme}
        onChange={(e) => setSendKeyScheme(e.target.value as SendKeyScheme)}
        className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
      >
        <option value="enter">Enter sends, Shift+Enter adds a new line</option>
        <option value="mod-enter">{modEnter} sends, Enter adds a new line</option>
      </select>
      <p className="mt-1.5 text-xs text-cc-muted">
        Applies to the message composer, comments, quest feedback, Side Chat and needs-input answers. On touch
        keyboards, Enter always adds a new line.
      </p>
    </div>
  );
}

/**
 * The key held while clicking to open a quest, topic or artifact in a leader's side column. Always
 * active, independent of the keyboard shortcut toggle.
 */
export function OpenInSideModifierSetting({
  shortcutPlatform,
  hidden = false,
}: {
  shortcutPlatform?: string;
  hidden?: boolean;
}) {
  const modifier = useStore((s) => s.shortcutSettings.openInSideModifier);
  const setModifier = useStore((s) => s.setOpenInSideModifier);
  const mac = platformIsMac(shortcutPlatform);
  return (
    <div hidden={hidden}>
      <label className="block text-sm font-medium mb-1.5" htmlFor="open-in-side-modifier">
        Open in Side Column
      </label>
      <select
        id="open-in-side-modifier"
        value={modifier}
        onChange={(e) => setModifier(e.target.value as OpenInSideModifier)}
        className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
      >
        <option value="shift">Shift-click</option>
        <option value="alt">{mac ? "Option-click" : "Alt-click"}</option>
      </select>
      <p className="mt-1.5 text-xs text-cc-muted">
        Clicking a quest, topic, artifact or report with this key held opens it in the leader's side column, beside the
        conversation, instead of in its place. {mac ? "⌘-click" : "Ctrl-click"} on an artifact opens it in a window of
        its own.
      </p>
    </div>
  );
}

/** Type-to-compose switch. Always active, independent of the keyboard shortcut toggle. */
export function TypeToComposeSetting({ hidden = false }: { hidden?: boolean }) {
  const typeToCompose = useStore((s) => s.shortcutSettings.typeToCompose);
  const setTypeToCompose = useStore((s) => s.setTypeToCompose);
  return (
    <SettingsToggle
      label="Type anywhere to write a message"
      description="When nothing else has focus, typing or pasting opens the message box with what you typed, and Enter opens it empty. Esc closes it again and keeps your draft."
      checked={typeToCompose}
      onChange={setTypeToCompose}
      hidden={hidden}
    />
  );
}
