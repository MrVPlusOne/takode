// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";

const mockReadFileLinkText = vi.fn();
const mockGetSettings = vi.fn();
const mockUseFileMachine = vi.fn();
const mockDownloadFileLink = vi.fn();

vi.mock("../api/file-link-actions.js", async () => {
  const actual = await vi.importActual<typeof import("../api/file-link-actions.js")>("../api/file-link-actions.js");
  return {
    ...actual,
    readFileLinkText: (...args: unknown[]) => mockReadFileLinkText(...args),
    downloadFileLink: (...args: unknown[]) => mockDownloadFileLink(...args),
    // Files in FILES exist; anything else is missing.
    resolveFileLinkAction: async ({ path }: { path: string }) => ({
      absolutePath: path,
      requestedPath: path,
      exists: path in FILES,
      isFile: path in FILES,
      isDirectory: false,
      isImage: false,
      size: SIZES[path] ?? FILES[path]?.length,
      canRevealInFinder: false,
      platform: "linux",
    }),
  };
});
vi.mock("../api.js", async () => {
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  return { ...actual, api: { ...actual.api, getSettings: (...args: unknown[]) => mockGetSettings(...args) } };
});
vi.mock("../remote-hosts.js", async () => {
  const actual = await vi.importActual<typeof import("../remote-hosts.js")>("../remote-hosts.js");
  return { ...actual, useFileMachine: (...args: unknown[]) => mockUseFileMachine(...args) };
});

import { FileViewerHost, closeFileViewers, openFileViewer } from "./FileViewer.js";
import { closeSecondaryViewers, setSecondaryViewTarget } from "../utils/secondary-view.js";

const FILES: Record<string, string> = {
  "/reports/briefing.md": "# Briefing\n\nSee [the details](notes/details.md).",
  "/reports/notes/details.md": "# Details\n\nNothing else.",
  "/home/coder/run.py": "print('hi')",
  "/data/model.bin": "",
};

/** Sizes the resolver reports where a file's text stands in for much larger content. */
const SIZES: Record<string, number> = { "/data/model.bin": 200 * 1024 * 1024 };

function popstateOnce(): Promise<void> {
  return new Promise((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
}

/**
 * The viewer shows a linked Markdown file inside Takode. These tests cover how it behaves as a
 * stack of sheets: links in a viewed file open the next file above it, resolved beside the file
 * and through the same session, and the phone's back gesture closes only the top one.
 */
describe("FileViewer", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.history.replaceState(null, "", "#/session/s1");
    mockReadFileLinkText.mockReset();
    mockDownloadFileLink.mockReset();
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "none" } });
    mockUseFileMachine.mockReturnValue({ name: "devbox", settings: { claudeBinary: "", codexBinary: "" } });
    act(() => closeFileViewers());
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
        <FileViewerHost />
      </StrictMode>,
    );
    act(() => openFileViewer({ path: "/reports/briefing.md", isRelative: false, sessionId: "s1" }));

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
    render(<FileViewerHost />);
    act(() => {
      openFileViewer({ path: "/reports/briefing.md", isRelative: false });
      openFileViewer({ path: "/reports/notes/details.md", isRelative: false });
    });
    await screen.findByRole("dialog", { name: "details.md" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "details.md" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "briefing.md" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close file" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows why a file cannot be opened", async () => {
    render(<FileViewerHost />);
    act(() => openFileViewer({ path: "/reports/missing.md", isRelative: false }));

    const viewer = await screen.findByRole("dialog", { name: "missing.md" });
    expect((await within(viewer).findByRole("alert")).textContent).toBe(
      "Cannot open this: Nothing at /reports/missing.md",
    );
    fireEvent.click(within(viewer).getByRole("button", { name: "Close file" }));
  });

  // Open in VS Code opens on the user's own computer, so it works for another machine's files only
  // over Remote-SSH. Until that machine is set up, the button is grayed out and its tooltip says why.
  it("grays out Open in VS Code for a machine that isn't set up, and opens over SSH once it is", async () => {
    mockGetSettings.mockResolvedValue({ editorConfig: { editor: "vscode-local" } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const view = render(<FileViewerHost />);
    act(() => openFileViewer({ path: "/home/coder/run.py", isRelative: false, line: 1 }));

    const viewer = await screen.findByRole("dialog", { name: "run.py" });
    const button = await within(viewer).findByRole("button", { name: "Open in VS Code" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.parentElement?.getAttribute("title")).toContain("VS Code can't reach devbox yet");
    fireEvent.click(button);
    expect(openSpy).not.toHaveBeenCalled();

    mockUseFileMachine.mockReturnValue({
      name: "devbox",
      settings: { claudeBinary: "", codexBinary: "", editorAccess: "ssh", sshHost: "devbox" },
    });
    view.rerender(<FileViewerHost />);
    fireEvent.click(within(viewer).getByRole("button", { name: "Open in VS Code" }));
    expect(openSpy).toHaveBeenCalledWith(
      "vscode://vscode-remote/ssh-remote+devbox/home/coder/run.py:1:1",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  // Download saves the viewed file to the browser's device, read through the linking session so a
  // remote host's file comes from that host; a file over the limit says why it can't be downloaded.
  it("downloads the viewed file through its session, and explains files too large to download", async () => {
    render(<FileViewerHost />);
    act(() => openFileViewer({ path: "/home/coder/run.py", isRelative: false, sessionId: "s1" }));
    const viewer = await screen.findByRole("dialog", { name: "run.py" });
    fireEvent.click(await within(viewer).findByRole("button", { name: "Download" }));
    expect(mockDownloadFileLink).toHaveBeenCalledWith({
      path: "/home/coder/run.py",
      isRelative: false,
      sessionId: "s1",
    });

    act(() => openFileViewer({ path: "/data/model.bin", isRelative: false, sessionId: "s1" }));
    const big = await screen.findByRole("dialog", { name: "model.bin" });
    const button = await within(big).findByRole("button", { name: "Too large to download (over 100 MB)" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(mockDownloadFileLink).toHaveBeenCalledTimes(1);
  });

  // A Markdown file has what report cards have: Download (the file itself, from its machine) and
  // exports made from the file as the viewer renders it, all in the Download button's menu.
  it("offers Download and the report exports for a Markdown file", async () => {
    const fetchMock = vi.fn(async () => new Response("%PDF-"));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:export");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    try {
      render(<FileViewerHost />);
      act(() => openFileViewer({ path: "/reports/briefing.md", isRelative: false, sessionId: "s1" }));
      const viewer = await screen.findByRole("dialog", { name: "briefing.md" });
      await within(viewer).findByRole("heading", { name: "Briefing" });

      fireEvent.click(within(viewer).getByRole("button", { name: "Download or export" }));
      for (const name of ["Export as PDF (.pdf)", "Export as image (.png)", "Export as web page (.html)"]) {
        expect(screen.getByRole("button", { name })).toBeTruthy();
      }
      fireEvent.click(screen.getByRole("button", { name: "Download (.md)" }));
      expect(mockDownloadFileLink).toHaveBeenCalledWith({
        path: "/reports/briefing.md",
        isRelative: false,
        sessionId: "s1",
      });

      fireEvent.click(within(viewer).getByRole("button", { name: "Download or export" }));
      fireEvent.click(screen.getByRole("button", { name: "Export as PDF (.pdf)" }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/exports/document");
      const body = JSON.parse(String(init.body)) as { html: string; format: string };
      expect(body.format).toBe("pdf");
      expect(body.html).toContain("<title>briefing.md</title>");
      expect(body.html).toContain("the details");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // On wide screens the app registers a secondary view area floating over the app: files open
  // there, stacked, with no backdrop of their own, and the area can dismiss them all at once.
  it("opens files in the secondary view area when one is available", async () => {
    const area = document.createElement("div");
    document.body.appendChild(area);
    act(() => setSecondaryViewTarget(area));
    try {
      render(<FileViewerHost />);
      act(() => {
        openFileViewer({ path: "/reports/briefing.md", isRelative: false });
        openFileViewer({ path: "/reports/notes/details.md", isRelative: false });
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
