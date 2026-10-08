import { describe, expect, it } from "vitest";
import { computeSettingsSearchResults, SETTINGS_SECTIONS } from "./settings-search.js";

describe("settings search", () => {
  it("keeps item ids unique within each group so row hiding is unambiguous", () => {
    for (const section of SETTINGS_SECTIONS) {
      const ids = section.items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("reveals a subsection when any of its items match and hides sibling subsections", () => {
    // Subsections are hidden by their key, so a match on one voice item must
    // surface the whole Voice Transcription block but not Keyboard Shortcuts.
    const results = computeSettingsSearchResults("vocabulary");
    const inputItems = results.visibleItemIds.get("input");
    expect(results.visibleSectionIds.has("input")).toBe(true);
    expect(inputItems?.has("voice")).toBe(true);
    expect(inputItems?.has("voice-vocabulary")).toBe(true);
    expect(inputItems?.has("shortcuts")).toBe(false);
  });

  it("lists every subsection key when there is no query", () => {
    const results = computeSettingsSearchResults("");
    const notificationItems = results.visibleItemIds.get("notifications");
    for (const key of ["browser", "phone-alerts", "web-push", "pushover"]) {
      expect(notificationItems?.has(key)).toBe(true);
    }
  });
});
