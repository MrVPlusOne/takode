// @vitest-environment jsdom
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { extractMentionedLocalImagePaths, QuestPhaseNoteImages } from "./QuestPhaseNoteImages.js";

vi.mock("../api.js", () => ({
  api: {
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
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
        path: "/tmp/run/desktop.png",
        filename: "desktop.png",
        url: "/api/fs/image?path=%2Ftmp%2Frun%2Fdesktop.png",
      },
      {
        path: "/Users/me/shot two.jpeg",
        filename: "shot two.jpeg",
        url: "/api/fs/image?path=%2FUsers%2Fme%2Fshot%20two.jpeg",
      },
    ]);
  });

  it("shows only successfully loaded thumbnails and browses loaded images in the modal", () => {
    // The component renders candidates only after the browser confirms image
    // load, so missing paths disappear without a visible broken-image state.
    render(
      <QuestPhaseNoteImages text={"Screenshots: /tmp/one.png `/tmp/two.jpeg` /tmp/missing.webp /tmp/notes.txt"} />,
    );

    const thumbnailStrip = screen.getByTestId("phase-note-image-thumbnails");
    expect(within(thumbnailStrip).queryByRole("button", { name: "Open image one.png" })).toBeNull();

    fireEvent.load(screen.getByAltText("one.png"));
    fireEvent.load(screen.getByAltText("two.jpeg"));
    fireEvent.error(screen.getByAltText("missing.webp"));

    expect(within(thumbnailStrip).getByRole("button", { name: "Open image one.png" })).toBeVisible();
    expect(within(thumbnailStrip).getByRole("button", { name: "Open image two.jpeg" })).toBeVisible();
    expect(within(thumbnailStrip).queryByRole("button", { name: "Open image missing.webp" })).toBeNull();

    fireEvent.click(within(thumbnailStrip).getByRole("button", { name: "Open image one.png" }));
    expect(screen.getByRole("dialog", { name: "Image preview: one.png" })).toBeVisible();
    expect(screen.getByTestId("phase-note-image-modal-filename")).toHaveTextContent("one.png");

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("dialog", { name: "Image preview: two.jpeg" })).toBeVisible();
    expect(screen.getByTestId("phase-note-image-modal-filename")).toHaveTextContent("two.jpeg");

    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(screen.getByRole("dialog", { name: "Image preview: one.png" })).toBeVisible();
  });
});
