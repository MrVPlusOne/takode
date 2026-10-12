// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";

/**
 * A stand-in sheet owner: the hook only needs whether a sheet is open, the sheet element and a
 * close callback. Links inside the sheet close it when followed, like the quest preview's actions.
 */
function SheetHarness({ onLinkClick }: { onLinkClick?: () => void }) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  usePreviewSheetHistoryEntry(open, sheetRef, () => setOpen(false));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      {open && (
        <div ref={sheetRef} role="dialog" aria-label="Sheet">
          <a
            href="#/session/s1?quest=q-1"
            onClick={() => {
              onLinkClick?.();
              setOpen(false);
            }}
          >
            Open quest
          </a>
          <a href="https://example.com/" onClick={(event) => event.preventDefault()}>
            External
          </a>
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}

function popstateOnce(): Promise<void> {
  return new Promise((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
}

describe("usePreviewSheetHistoryEntry", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/session/s1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds an entry for the open sheet and closes the sheet on the back gesture", async () => {
    // The phone's back gesture is a history traversal; it must close the sheet, not leave the page.
    render(<SheetHarness />);
    const lengthBefore = window.history.length;
    act(() => screen.getByRole("button", { name: "Open sheet" }).click());
    expect(window.history.length).toBe(lengthBefore + 1);
    expect(window.location.hash).toBe("#/session/s1");

    const popped = popstateOnce();
    act(() => window.history.back());
    await act(async () => popped);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe("#/session/s1");
  });

  it("removes its entry when the sheet is closed another way", () => {
    render(<SheetHarness />);
    act(() => screen.getByRole("button", { name: "Open sheet" }).click());
    const back = vi.spyOn(window.history, "back");
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("follows a same-page link only after removing its entry, so no dead back step remains", async () => {
    // Without holding the link, the new route would sit on top of the sheet's entry and the next back
    // press would land on that entry and appear to do nothing.
    const onLinkClick = vi.fn();
    render(<SheetHarness onLinkClick={onLinkClick} />);
    const lengthBefore = window.history.length;
    act(() => screen.getByRole("button", { name: "Open sheet" }).click());

    const popped = popstateOnce();
    act(() => screen.getByRole("link", { name: "Open quest" }).click());
    expect(onLinkClick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => popped);

    await waitFor(() => expect(window.location.hash).toBe("#/session/s1?quest=q-1"));
    expect(onLinkClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The sheet entry was replaced by the followed link: one new entry, as if the link were tapped directly.
    expect(window.history.length).toBe(lengthBefore + 1);
  });

  it("leaves links to other pages alone", () => {
    render(<SheetHarness />);
    act(() => screen.getByRole("button", { name: "Open sheet" }).click());
    const back = vi.spyOn(window.history, "back");
    act(() => screen.getByRole("link", { name: "External" }).click());
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
