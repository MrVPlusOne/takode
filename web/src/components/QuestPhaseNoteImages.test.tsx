// @vitest-environment jsdom
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { extractMentionedLocalImagePaths, QuestPhaseNoteImages } from "./QuestPhaseNoteImages.js";

vi.mock("../api.js", () => ({
  api: {
    getFsImageUrl: (path: string, variant?: "thumbnail" | "full") => {
      const params = new URLSearchParams({ path });
      if (variant) params.set("variant", variant);
      return `/api/fs/image?${params.toString()}`;
    },
  },
}));

describe("QuestPhaseNoteImages", () => {
  it("extracts supported absolute image paths from bare text and code spans", () => {
    // This keeps the parser scoped to local image artifacts and avoids widening
    // phase-note previews to arbitrary Markdown links or non-image file paths.
    const images = extractMentionedLocalImagePaths(
      "Evidence: /tmp/run/desktop.png, `/Users/me/shot two.jpeg` and /tmp/readme.txt.",
    );

    expect(images).toEqual([
      {
        id: "path:/tmp/run/desktop.png",
        filename: "desktop.png",
        thumbnailUrl: "/api/fs/image?path=%2Ftmp%2Frun%2Fdesktop.png&variant=thumbnail",
        fullUrl: "/api/fs/image?path=%2Ftmp%2Frun%2Fdesktop.png&variant=full",
        title: "/tmp/run/desktop.png",
      },
      {
        id: "path:/Users/me/shot two.jpeg",
        filename: "shot two.jpeg",
        thumbnailUrl: "/api/fs/image?path=%2FUsers%2Fme%2Fshot+two.jpeg&variant=thumbnail",
        fullUrl: "/api/fs/image?path=%2FUsers%2Fme%2Fshot+two.jpeg&variant=full",
        title: "/Users/me/shot two.jpeg",
      },
    ]);
  });

  it("extracts local file links without broadening to remote images", () => {
    const images = extractMentionedLocalImagePaths(
      "Preview [relative](file:artifacts/preview.png) ![absolute](file:/tmp/shot.png:12) ![remote](https://example.com/x.png)",
      "s1",
    );

    expect(images).toEqual([
      {
        id: "file:artifacts/preview.png",
        filename: "preview.png",
        thumbnailUrl:
          "/api/fs/file-link/image?path=artifacts%2Fpreview.png&isRelative=1&variant=thumbnail&sessionId=s1",
        fullUrl: "/api/fs/file-link/image?path=artifacts%2Fpreview.png&isRelative=1&variant=full&sessionId=s1",
        title: "artifacts/preview.png",
      },
      {
        id: "path:/tmp/shot.png",
        filename: "shot.png",
        thumbnailUrl: "/api/fs/image?path=%2Ftmp%2Fshot.png&variant=thumbnail",
        fullUrl: "/api/fs/image?path=%2Ftmp%2Fshot.png&variant=full",
        title: "/tmp/shot.png",
      },
    ]);
  });

  it("shows only successfully loaded thumbnail-only previews and browses loaded images in the modal", () => {
    // The component renders candidates only after the browser confirms image
    // load, so missing paths disappear without a visible broken-image state.
    render(
      <QuestPhaseNoteImages text={"Screenshots: /tmp/one.png `/tmp/two.jpeg` /tmp/missing.webp /tmp/notes.txt"} />,
    );

    expect(screen.queryByTestId("phase-note-image-thumbnails")).toBeNull();

    const preloadImages = screen.getAllByTestId("image-preview-preload");
    fireEvent.load(preloadImages[0]!);
    fireEvent.load(preloadImages[1]!);
    fireEvent.error(preloadImages[2]!);

    const thumbnailStrip = screen.getByTestId("phase-note-image-thumbnails");
    expect(within(thumbnailStrip).getByRole("button", { name: "Open image one.png" })).toBeVisible();
    expect(within(thumbnailStrip).getByRole("button", { name: "Open image two.jpeg" })).toBeVisible();
    expect(within(thumbnailStrip).queryByRole("button", { name: "Open image missing.webp" })).toBeNull();
    expect(within(thumbnailStrip).queryByText("one.png")).toBeNull();

    fireEvent.click(within(thumbnailStrip).getByRole("button", { name: "Open image one.png" }));
    expect(screen.getByRole("dialog", { name: "Image preview: one.png" })).toBeVisible();
    expect(screen.getByTestId("image-preview-modal-filename")).toHaveTextContent("one.png");
    expect(screen.getByTestId("image-preview-modal-index")).toHaveTextContent("1 of 2");

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("dialog", { name: "Image preview: two.jpeg" })).toBeVisible();
    expect(screen.getByTestId("image-preview-modal-filename")).toHaveTextContent("two.jpeg");

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "Image preview: one.png" })).toBeVisible();
  });

  it("keeps the modal filename centered separately from the right-aligned navigation controls", () => {
    render(<QuestPhaseNoteImages text={"Screenshots: /tmp/one.png `/tmp/two.jpeg`"} />);

    const preloadImages = screen.getAllByTestId("image-preview-preload");
    fireEvent.load(preloadImages[0]!);
    fireEvent.load(preloadImages[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Open image one.png" }));

    const header = screen.getByTestId("image-preview-modal-header");
    const title = screen.getByTestId("image-preview-modal-title");
    const controls = screen.getByTestId("image-preview-modal-controls");
    const footprint = screen.getByTestId("image-preview-modal-control-footprint");
    const filename = within(title).getByTestId("image-preview-modal-filename");

    expect(header).toHaveClass("grid", "grid-cols-[minmax(max-content,1fr)_minmax(0,42rem)_minmax(max-content,1fr)]");
    expect(footprint).toHaveClass("invisible", "col-start-1");
    expect(footprint).toHaveAttribute("aria-hidden", "true");
    expect(title).toHaveClass("col-start-2", "min-w-0", "max-w-full", "justify-self-stretch", "overflow-hidden");
    expect(filename).toHaveTextContent("one.png");
    expect(filename).toHaveClass("w-full", "truncate");
    expect(within(controls).queryByTestId("image-preview-modal-filename")).toBeNull();
    expect(controls).toHaveClass("col-start-3", "justify-self-end");
    expect(within(controls).getByRole("button", { name: "Previous image" })).toBeVisible();
    expect(within(controls).getByRole("button", { name: "Next image" })).toBeVisible();
    expect(within(controls).getByTestId("image-preview-modal-index")).toHaveTextContent("1 of 2");
    expect(within(controls).getByRole("button", { name: "Close image preview" })).toBeVisible();
  });

  it("absorbs Escape when closing the shared image modal", () => {
    render(<QuestPhaseNoteImages text={"Screenshot: /tmp/one.png"} />);

    fireEvent.load(screen.getByTestId("image-preview-preload"));
    fireEvent.click(screen.getByRole("button", { name: "Open image one.png" }));

    const downstreamKeyHandler = vi.fn();
    document.addEventListener("keydown", downstreamKeyHandler);
    try {
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("image-preview-modal")).toBeNull();
      expect(downstreamKeyHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", downstreamKeyHandler);
    }
  });
});
