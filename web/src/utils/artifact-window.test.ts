// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  artifactWindowHash,
  isNewWindowClick,
  openArtifactWindow,
  openInMainWindow,
  parseArtifactWindowHash,
} from "./artifact-window.js";
import { parseHash } from "./routing.js";

/**
 * Artifacts in a window of their own: the page they open, the click that asks for one (Cmd on Mac,
 * Ctrl elsewhere, as in browsers), opening it through `window.open` so an installed app opens an app
 * window too, and links from it that go back to the window it came from.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const click = { shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };

describe("artifact windows", () => {
  it("names the artifact and version in the page, which the router reads as its own page", () => {
    expect(artifactWindowHash("0f1e2d3c-aa", 2)).toBe("#/artifact/0f1e2d3c-aa?v=2");
    expect(parseArtifactWindowHash("#/artifact/0f1e2d3c-aa?v=2")).toEqual({ id: "0f1e2d3c-aa", version: 2 });
    expect(parseArtifactWindowHash("#/artifact/0f1e2d3c-aa")).toEqual({ id: "0f1e2d3c-aa" });
    expect(parseArtifactWindowHash("#/library")).toBeNull();
    // Not "home", which would restore the last conversation into the window.
    expect(parseHash("#/artifact/0f1e2d3c-aa?v=2")).toEqual({
      page: "artifact",
      artifactId: "0f1e2d3c-aa",
      version: 2,
    });
  });

  it("takes Ctrl-click (jsdom is not a Mac) alone as asking for a new window", () => {
    expect(isNewWindowClick({ ...click, ctrlKey: true })).toBe(true);
    expect(isNewWindowClick({ ...click, metaKey: true })).toBe(false);
    expect(isNewWindowClick({ ...click, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isNewWindowClick(click)).toBe(false);
    expect(isNewWindowClick(undefined)).toBe(false);
  });

  it("opens one window per artifact, focused, through window.open with window features", () => {
    const focus = vi.fn();
    const open = vi.fn(() => ({ focus }) as unknown as Window);
    vi.stubGlobal("open", open);
    openArtifactWindow({ id: "abc", version: 3 });
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/#\/artifact\/abc\?v=3$/),
      "takode-artifact-abc",
      expect.stringContaining("popup"),
    );
    expect(focus).toHaveBeenCalled();
  });

  it("shows a conversation in the window it came from, else in a new tab", () => {
    const opener = { closed: false, location: { origin: window.location.origin, hash: "" }, focus: vi.fn() };
    vi.stubGlobal("opener", opener);
    openInMainWindow("#/session/s1/msg/m1");
    expect(opener.location.hash).toBe("#/session/s1/msg/m1");
    expect(opener.focus).toHaveBeenCalled();

    vi.stubGlobal("opener", null);
    const open = vi.fn();
    vi.stubGlobal("open", open);
    openInMainWindow("#/session/s1/msg/m1");
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/#\/session\/s1\/msg\/m1$/), "_blank");
  });
});
