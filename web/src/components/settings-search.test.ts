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
    // Subsections are hidden by their key, so a match on one Pushover item must
    // surface the whole Pushover block but not the sibling Web Push block.
    const results = computeSettingsSearchResults("pushover token");
    const notificationItems = results.visibleItemIds.get("notifications");
    expect(results.visibleSectionIds.has("notifications")).toBe(true);
    expect(notificationItems?.has("pushover")).toBe(true);
    expect(notificationItems?.has("pushover-credentials")).toBe(true);
    expect(notificationItems?.has("web-push")).toBe(false);
  });

  it("finds app-action shortcuts such as Universal Search under Keyboard only", () => {
    // Shortcut bindings are keyboard settings; searching an action name should
    // lead to the Keyboard group rather than an unrelated group.
    const results = computeSettingsSearchResults("universal search");
    expect([...results.visibleSectionIds]).toEqual(["keyboard"]);
    expect(results.visibleItemIds.get("keyboard")?.has("shortcuts")).toBe(true);
  });

  it("lists every subsection key when there is no query", () => {
    const results = computeSettingsSearchResults("");
    const notificationItems = results.visibleItemIds.get("notifications");
    for (const key of ["browser", "phone-alerts", "web-push", "pushover"]) {
      expect(notificationItems?.has(key)).toBe(true);
    }
  });
});
