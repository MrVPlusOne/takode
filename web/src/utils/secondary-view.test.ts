// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeSecondaryViewers,
  openSecondaryPage,
  setSecondaryViewTarget,
  toggleSecondaryPage,
  useSecondaryViewersMaxWidth,
  useSecondaryViewOccupied,
  useSecondaryViewTarget,
} from "./secondary-view.js";

/**
 * Viewers opened from the conversation ask this module where to render: into the right-hand
 * area the app shell registers on wide screens, or (null) as their own full-screen modal.
 */
describe("secondary view area registry", () => {
  afterEach(() => act(() => setSecondaryViewTarget(null)));

  it("renders viewers as modals when the layout has no right-hand area", () => {
    const { result } = renderHook(() => useSecondaryViewTarget(true, vi.fn(), "reading"));
    expect(result.current).toBeNull();
  });

  it("hands open viewers the area, tracks them, and lets the area dismiss them", () => {
    const area = document.createElement("div");
    act(() => setSecondaryViewTarget(area));
    const onClose = vi.fn();

    const viewer = renderHook(({ open }) => useSecondaryViewTarget(open, onClose, "reading"), {
      initialProps: { open: true },
    });
    const occupied = renderHook(() => useSecondaryViewOccupied());

    expect(viewer.result.current).toBe(area);
    expect(occupied.result.current).toBe(true);

    // An outside click closes every viewer in the area.
    closeSecondaryViewers();
    expect(onClose).toHaveBeenCalledTimes(1);

    viewer.rerender({ open: false });
    expect(viewer.result.current).toBeNull();
    expect(occupied.result.current).toBe(false);
  });

  // The area grows to the widest of the viewers open in it, so a narrow viewer opened over a wide
  // one does not shrink it, and it falls back once the wide one closes.
  it("reports the widest maximum among the open viewers", () => {
    act(() => setSecondaryViewTarget(document.createElement("div")));
    const maxWidth = renderHook(() => useSecondaryViewersMaxWidth());
    expect(maxWidth.result.current).toBe(0);

    const image = renderHook(({ open }) => useSecondaryViewTarget(open, vi.fn(), "media"), {
      initialProps: { open: true },
    });
    renderHook(() => useSecondaryViewTarget(true, vi.fn(), "reading"));
    expect(maxWidth.result.current).toBe(1600);

    image.rerender({ open: false });
    expect(maxWidth.result.current).toBe(880);
  });
});

describe("secondary page navigation", () => {
  beforeEach(() => {
    window.location.hash = "#/session/s1/msg/7?thread=q-9";
  });

  it("opens a page over the current session and thread, dropping message deep links", () => {
    openSecondaryPage("memory");
    expect(window.location.hash).toBe("#/session/s1?thread=q-9&view=memory");
  });

  it("toggles a page closed back to the session", () => {
    toggleSecondaryPage("questmaster");
    expect(window.location.hash).toBe("#/session/s1?thread=q-9&view=questmaster");
    toggleSecondaryPage("questmaster");
    expect(window.location.hash).toBe("#/session/s1?thread=q-9");
  });

  it("falls back to the page path when no session is open", () => {
    window.location.hash = "";
    openSecondaryPage("settings");
    expect(window.location.hash).toBe("#/settings");
  });
});
