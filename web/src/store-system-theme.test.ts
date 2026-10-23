// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// A controllable stand-in for the device's light/dark setting. It must exist before store.ts
// loads, because the store subscribes to it at import time.
const system = vi.hoisted(() => {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const state = { dark: false };
  Object.defineProperty(globalThis.window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return state.dark;
      },
      media: query,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
        listeners.delete(listener),
    }),
  });
  return {
    /** Flip the device setting, as iOS does at sunset with automatic dark mode. */
    set(dark: boolean) {
      state.dark = dark;
      for (const listener of listeners) listener({ matches: dark });
    },
  };
});

import { getInitialColorTheme } from "./store-initial.js";
import { COLOR_THEMES, useStore } from "./store.js";

afterEach(() => {
  localStorage.clear();
  system.set(false);
});

describe("System theme", () => {
  it("offers Light, Dark and System, and no longer the VS Code theme", () => {
    expect(COLOR_THEMES.map((theme) => theme.label)).toEqual(["Light", "Dark", "System"]);
  });

  it("follows the device's setting live, without a reload", () => {
    system.set(false);
    useStore.getState().setColorTheme("system");
    expect(useStore.getState().darkMode).toBe(false);
    system.set(true);
    expect(useStore.getState().darkMode).toBe(true);
    system.set(false);
    expect(useStore.getState().darkMode).toBe(false);
    expect(localStorage.getItem("cc-color-theme")).toBe("system");
  });

  it("ignores the device's setting when Light or Dark is chosen", () => {
    useStore.getState().setColorTheme("light");
    system.set(true);
    expect(useStore.getState().darkMode).toBe(false);
  });

  it("starts a browser that had the retired VS Code theme on Dark, and a new browser on System", () => {
    localStorage.setItem("cc-color-theme", "vscode-dark");
    expect(getInitialColorTheme()).toBe("dark");
    localStorage.clear();
    expect(getInitialColorTheme()).toBe("system");
    // An old dark/light flag without a chosen theme still wins over following the device.
    localStorage.setItem("cc-dark-mode", "false");
    expect(getInitialColorTheme()).toBe("light");
  });
});
