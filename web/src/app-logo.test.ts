// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { appLogoSrc, applyThemeToDocument } from "./app-logo.js";

afterEach(() => {
  document.head.innerHTML = "";
  document.documentElement.classList.remove("dark");
});

describe("appLogoSrc", () => {
  it("uses the day painting in the light theme and the night painting in the dark theme", () => {
    expect(appLogoSrc(false)).toBe("/app-logo.png");
    expect(appLogoSrc(true)).toBe("/app-logo-night.png");
  });
});

describe("applyThemeToDocument", () => {
  // The browser tab's icon follows Takode's own theme (not the system's), so it always matches
  // the in-app logo; switching back must restore the day favicon.
  it("sets the dark class and points the favicon at the matching mark", () => {
    document.head.innerHTML = '<link rel="icon" type="image/png" href="/favicon.png" />';
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;

    applyThemeToDocument(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(new URL(favicon.href).pathname).toBe("/favicon-night.png");

    applyThemeToDocument(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(new URL(favicon.href).pathname).toBe("/favicon.png");
  });

  // Pages without a favicon link (tests, embedded views) still get the theme class.
  it("still applies the theme when the page has no favicon link", () => {
    applyThemeToDocument(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
