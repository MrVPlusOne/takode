import { api, type AppSettings } from "./api.js";
import { DEFAULT_SHORTCUT_SETTINGS, normalizeShortcutSettings, type ShortcutSettings } from "./shortcuts.js";
import { scopedGetItem, scopedRemoveItem } from "./utils/scoped-storage.js";

const LEGACY_SHORTCUT_STORAGE_KEY = "cc-shortcuts";

export function getInitialShortcutSettings(): ShortcutSettings {
  return DEFAULT_SHORTCUT_SETTINGS;
}

export function persistShortcutSettingsToServer(
  settings: ShortcutSettings,
  applyServerSettings: (settings: ShortcutSettings) => void,
): void {
  const normalized = normalizeShortcutSettings(settings);
  api
    .updateSettings({ shortcutSettings: normalized })
    .then((updated) => {
      if (updated.shortcutSettings) {
        applyServerSettings(updated.shortcutSettings);
        clearLegacyShortcutSettings();
      }
    })
    .catch((err) => {
      console.warn("[shortcuts] failed to persist shortcut settings", err);
    });
}

export function createShortcutSettingsHydrator(applyServerSettings: (settings: ShortcutSettings) => void) {
  return async function hydrateShortcutSettingsFromServer(
    settings: Pick<AppSettings, "shortcutSettings">,
  ): Promise<void> {
    if (settings.shortcutSettings) {
      applyServerSettings(settings.shortcutSettings);
      clearLegacyShortcutSettings();
      return;
    }

    const legacySettings = readLegacyShortcutSettings();
    if (!legacySettings) {
      applyServerSettings(DEFAULT_SHORTCUT_SETTINGS);
      return;
    }

    applyServerSettings(legacySettings);
    try {
      const updated = await api.updateSettings({ shortcutSettings: legacySettings });
      if (updated.shortcutSettings) {
        applyServerSettings(updated.shortcutSettings);
        clearLegacyShortcutSettings();
      }
    } catch (err) {
      console.warn("[shortcuts] failed to migrate local shortcut settings", err);
    }
  };
}

function readLegacyShortcutSettings(): ShortcutSettings | null {
  if (typeof window === "undefined") return null;
  const stored = scopedGetItem(LEGACY_SHORTCUT_STORAGE_KEY);
  if (!stored) return null;
  try {
    return normalizeShortcutSettings(JSON.parse(stored) as Partial<ShortcutSettings> | null);
  } catch {
    return null;
  }
}

function clearLegacyShortcutSettings(): void {
  if (typeof window === "undefined") return;
  scopedRemoveItem(LEGACY_SHORTCUT_STORAGE_KEY);
}
