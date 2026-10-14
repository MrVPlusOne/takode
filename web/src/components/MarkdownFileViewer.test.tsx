// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";

const mockReadFileLinkText = vi.fn();

vi.mock("../api/file-link-actions.js", async () => {
  const actual = await vi.importActual<typeof import("../api/file-link-actions.js")>("../api/file-link-actions.js");
  return { ...actual, readFileLinkText: (...args: unknown[]) => mockReadFileLinkText(...args) };
});

import { MarkdownFileViewerHost, openMarkdownFileViewer } from "./MarkdownFileViewer.js";
import { closeSecondaryViewers, setSecondaryViewTarget } from "../utils/secondary-view.js";

const FILES: Record<string, string> = {
  "/reports/briefing.md": "# Briefing\n\nSee [the details](notes/details.md).",
  "/reports/notes/details.md": "# Details\n\nNothing else.",
};

function popstateOnce(): Promise<void> {
  return new Promise((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
}

/**
 * The viewer shows a linked Markdown file inside Takode. These tests cover how it behaves as a
 * stack of sheets: links in a viewed file open the next file above it, resolved beside the file
 * and through the same session, and the phone's back gesture closes only the top one.
 */
describe("MarkdownFileViewer", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.history.replaceState(null, "", "#/session/s1");
    mockReadFileLinkText.mockReset();
    mockReadFileLinkText.mockImplementation(async ({ path }: { path: string }) => {
      if (!(path in FILES)) throw new Error("File not found");
      return { absolutePath: path, content: FILES[path] };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a link in a viewed file above it, and the back gesture closes only the top file", async () => {
    // StrictMode runs mount effects twice, as the development app does; a viewer must still stay open.
    render(
      <StrictMode>
        <MarkdownFileViewerHost />
      </StrictMode>,
    );
    act(() => openMarkdownFileViewer({ path: "/reports/briefing.md", isRelative: false, sessionId: "s1" }));

    const briefing = await screen.findByRole("dialog", { name: "briefing.md" });
    fireEvent.click(await within(briefing).findByRole("link", { name: "the details" }));

    // The relative link resolves beside the viewed file and is read through the same session.
    const details = await screen.findByRole("dialog", { name: "details.md" });
    expect(await within(details).findByRole("heading", { name: "Details" })).toBeTruthy();
    expect(mockReadFileLinkText).toHaveBeenLastCalledWith(
      { path: "/reports/notes/details.md", isRelative: false, sessionId: "s1" },
      expect.any(AbortSignal),
    );

    const popped = popstateOnce();
    act(() => window.history.back());
    await act(async () => popped);
    expect(screen.queryByRole("dialog", { name: "details.md" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "briefing.md" })).toBeTruthy();
    expect(window.location.hash).toBe("#/session/s1");

    const poppedAgain = popstateOnce();
    act(() => window.history.back());
    await act(async () => poppedAgain);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the top file with Escape and leaves the one below open", async () => {
    render(<MarkdownFileViewerHost />);
    act(() => {
      openMarkdownFileViewer({ path: "/reports/briefing.md", isRelative: false });
      openMarkdownFileViewer({ path: "/reports/notes/details.md", isRelative: false });
    });
    await screen.findByRole("dialog", { name: "details.md" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "details.md" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "briefing.md" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close file" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows why a file cannot be opened", async () => {
    render(<MarkdownFileViewerHost />);
    act(() => openMarkdownFileViewer({ path: "/reports/missing.md", isRelative: false }));

    const viewer = await screen.findByRole("dialog", { name: "missing.md" });
    expect((await within(viewer).findByRole("alert")).textContent).toBe("Cannot open this file: File not found");
    fireEvent.click(within(viewer).getByRole("button", { name: "Close file" }));
  });

  // On wide screens the app registers a right-hand area beside the conversation: files open there,
  // stacked, with no backdrop, and the area can dismiss them all at once.
  it("opens files in the right-hand area beside the conversation when one is available", async () => {
    const area = document.createElement("div");
    document.body.appendChild(area);
    act(() => setSecondaryViewTarget(area));
    try {
      render(<MarkdownFileViewerHost />);
      act(() => {
        openMarkdownFileViewer({ path: "/reports/briefing.md", isRelative: false });
        openMarkdownFileViewer({ path: "/reports/notes/details.md", isRelative: false });
      });
      const details = await screen.findByRole("dialog", { name: "details.md" });
      expect(area.contains(details)).toBe(true);
      expect(details.getAttribute("aria-modal")).toBeNull();

      act(() => closeSecondaryViewers());
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      act(() => setSecondaryViewTarget(null));
      area.remove();
    }
  });
});
