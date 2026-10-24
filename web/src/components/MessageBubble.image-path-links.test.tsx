// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ChatMessage } from "../types.js";

const mockResolveFileLinkAction = vi.hoisted(() => vi.fn());
const writeClipboardTextMock = vi.hoisted(() => vi.fn(async (_text: string) => undefined));

vi.mock("../api.js", () => ({
  api: {
    getFsImageUrl: (path: string, variant?: "thumbnail" | "full") => {
      const params = new URLSearchParams({ path });
      if (variant) params.set("variant", variant);
      return `/api/fs/image?${params.toString()}`;
    },
    getSettings: vi.fn(async () => ({})),
    markNotificationDone: vi.fn(async () => ({})),
    starMessage: vi.fn(async () => ({})),
    unstarMessage: vi.fn(async () => ({})),
  },
}));

vi.mock("../api/file-link-actions.js", async () => {
  const actual = await vi.importActual<typeof import("../api/file-link-actions.js")>("../api/file-link-actions.js");
  return { ...actual, resolveFileLinkAction: (...args: unknown[]) => mockResolveFileLinkAction(...args) };
});

vi.mock("../utils/copy-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/copy-utils.js")>("../utils/copy-utils.js");
  return { ...actual, writeClipboardText: (text: string) => writeClipboardTextMock(text) };
});

import { MessageBubble } from "./MessageBubble.js";
import { useStore } from "../store.js";

beforeEach(() => {
  useStore.getState().reset();
  mockResolveFileLinkAction.mockReset();
  mockResolveFileLinkAction.mockReturnValue(new Promise(() => {}));
  writeClipboardTextMock.mockClear();
});

function assistantMessage(text: string): ChatMessage {
  return {
    id: "assistant-image-paths",
    role: "assistant",
    content: "",
    contentBlocks: [{ type: "text", text }],
    timestamp: 1,
  };
}

function loadAllPreviews() {
  for (const image of screen.getAllByTestId("image-preview-preload")) fireEvent.load(image);
}

describe("MessageBubble image path links", () => {
  it("renders mentioned image paths as file-name links while thumbnails stay below", () => {
    // Bare and code-span absolute paths get previews, so they become compact links. A relative
    // path, a non-image path and a path inside a code block are not previewed and stay as text.
    render(
      <MessageBubble
        message={assistantMessage(
          [
            "The bar: /tmp/shots/01-bar-dark.png (light: `/tmp/shots/01-bar-light.png`).",
            "Not images: docs/02-other.png and /tmp/shots/notes.txt.",
            "```",
            "/tmp/shots/03-in-code-block.png",
            "```",
          ].join("\n"),
        )}
        sessionId="s1"
      />,
    );
    loadAllPreviews();

    const dark = screen.getByRole("link", { name: "01-bar-dark.png" });
    expect(dark.getAttribute("href")).toBe("file:/tmp/shots/01-bar-dark.png:1");
    expect(dark.getAttribute("title")).toContain("/tmp/shots/01-bar-dark.png");
    expect(screen.getByRole("link", { name: "01-bar-light.png" })).toBeTruthy();
    expect(screen.getByText(/\(light: /)).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText(/docs\/02-other\.png and \/tmp\/shots\/notes\.txt/)).toBeTruthy();
    expect(screen.getByText("/tmp/shots/03-in-code-block.png")).toBeTruthy();

    const group = screen.getByTestId("assistant-image-preview-group");
    expect(within(group).getByRole("button", { name: "Open image 01-bar-dark.png" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Open image 01-bar-light.png" })).toBeTruthy();
  });

  it("opens the thumbnail viewer on the clicked image with its full copyable path", async () => {
    render(
      <MessageBubble
        message={assistantMessage("First /tmp/shots/one.png, then `/tmp/shots/two.webp`.")}
        sessionId="s1"
      />,
    );
    loadAllPreviews();

    fireEvent.click(screen.getByRole("link", { name: "two.webp" }));

    // The same viewer as a thumbnail click: the message's images, positioned at the clicked one.
    expect(screen.getByRole("dialog", { name: "Image preview: two.webp" })).toBeTruthy();
    expect(screen.getByTestId("image-preview-modal-index")).toHaveTextContent("2 of 2");
    expect((await screen.findByTestId("image-preview-modal-image")).getAttribute("src")).toBe(
      "/api/fs/image?path=%2Ftmp%2Fshots%2Ftwo.webp&variant=full",
    );
    const pathRow = screen.getByTestId("image-preview-modal-path");
    expect(pathRow).toHaveTextContent("/tmp/shots/two.webp");
    fireEvent.click(within(pathRow).getByRole("button", { name: "Copy image path" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("/tmp/shots/two.webp");
    expect(await within(pathRow).findByText("Copied")).toBeTruthy();
    // Opening from a link must not fall back to the file-link preview or editor.
    expect(mockResolveFileLinkAction).not.toHaveBeenCalled();
  });

  it("opens Markdown file links to previewed images in the same viewer", () => {
    render(<MessageBubble message={assistantMessage("See [the shot](file:/tmp/shots/one.png).")} sessionId="s1" />);
    loadAllPreviews();

    fireEvent.click(screen.getByRole("link", { name: "the shot" }));

    expect(screen.getByRole("dialog", { name: "Image preview: one.png" })).toBeTruthy();
    expect(screen.getByTestId("image-preview-modal-path")).toHaveTextContent("/tmp/shots/one.png");
  });

  it("falls back to the normal file-link action when the image failed to load", () => {
    // A missing image has no thumbnail, so the viewer cannot show it; the link keeps its usual behavior.
    render(<MessageBubble message={assistantMessage("Gone: /tmp/shots/missing.png")} sessionId="s1" />);
    fireEvent.error(screen.getByTestId("image-preview-preload"));

    fireEvent.click(screen.getByRole("link", { name: "missing.png" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockResolveFileLinkAction).toHaveBeenCalledWith(expect.objectContaining({ path: "/tmp/shots/missing.png" }));
  });

  it("leaves messages without image paths unchanged", () => {
    render(<MessageBubble message={assistantMessage("Plain /tmp/build/output.log and a.png")} sessionId="s1" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Plain /tmp/build/output.log and a.png")).toBeTruthy();
  });
});
