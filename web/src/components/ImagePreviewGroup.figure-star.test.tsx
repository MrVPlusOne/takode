// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ArtifactMessageMarker } from "../../shared/artifact-library.js";
import type { ImagePreviewItem } from "./image-preview-utils.js";

const setStarred = vi.hoisted(() => vi.fn(async (_id: string, _starred: boolean) => ({})));
vi.mock("../api/artifacts.js", () => ({ artifactApi: { setStarred } }));

import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import { ArtifactMarkersContext } from "./artifact-card-menu.js";

beforeEach(() => setStarred.mockClear());

const PLOT = "/tmp/plots/trend.png";

function image(id: string, sourcePath?: string): ImagePreviewItem {
  return { id, filename: `${id}.png`, thumbnailUrl: `/thumb/${id}.png`, fullUrl: `/full/${id}.png`, sourcePath };
}

function figure(path: string, starred = false): ArtifactMessageMarker {
  return { id: `fig-${path}`, kind: "figure", title: "Trend", version: 1, versionCount: 1, path, starred };
}

function Feed({ images, markers }: { images: ImagePreviewItem[]; markers?: ArtifactMessageMarker[] }) {
  return (
    <ArtifactMarkersContext.Provider value={markers}>
      <ImagePreviewGroup images={images} />
    </ArtifactMarkersContext.Provider>
  );
}

async function openViewer(images: ImagePreviewItem[], markers?: ArtifactMessageMarker[]) {
  const view = render(<Feed images={images} markers={markers} />);
  for (const preload of screen.getAllByTestId("image-preview-preload")) fireEvent.load(preload);
  fireEvent.click(screen.getByRole("button", { name: `Open image ${images[0]!.filename}` }));
  await screen.findByTestId("image-preview-modal-image");
  return { ...view, row: screen.getByTestId("image-preview-modal-path") };
}

describe("Starring a figure from the image viewer", () => {
  it("stars the Library figure the message saved from the shown image", async () => {
    const { row } = await openViewer([image("trend", PLOT)], [figure(PLOT)]);

    const star = within(row).getByRole("button", { name: "Star image" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);

    expect(setStarred).toHaveBeenCalledWith(`fig-${PLOT}`, true);
    // The click must not close the viewer.
    expect(screen.getByRole("dialog", { name: "Image preview: trend.png" })).toBeVisible();
  });

  it("follows the server's star while open, and unstars", async () => {
    // The server refreshes the conversation after a star, so the open viewer gets a new marker.
    const images = [image("trend", PLOT)];
    const { row, rerender } = await openViewer(images, [figure(PLOT)]);
    rerender(<Feed images={images} markers={[figure(PLOT, true)]} />);

    const star = within(row).getByRole("button", { name: "Unstar image" });
    expect(star).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(star);
    expect(setStarred).toHaveBeenCalledWith(`fig-${PLOT}`, false);
  });

  it("shows no star for an image that is not a Library figure of this message", async () => {
    // Another figure of the message, and an uploaded image without a path, have nothing to star here.
    const { row } = await openViewer([image("shot", "/tmp/plots/other.png")], [figure(PLOT)]);
    expect(within(row).queryByTestId("image-preview-modal-star")).toBeNull();
  });

  it("keeps the star out of the header, which on a phone has no room for another button", async () => {
    await openViewer([image("trend", PLOT)], [figure(PLOT)]);
    expect(
      within(screen.getByTestId("image-preview-modal-header")).queryByTestId("image-preview-modal-star"),
    ).toBeNull();
  });
});
