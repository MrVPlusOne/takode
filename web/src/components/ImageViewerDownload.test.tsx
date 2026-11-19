// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ImagePreviewItem } from "./image-preview-utils.js";

const save = vi.hoisted(() => vi.fn(async (_file: { url: string; name: string }) => undefined));
vi.mock("../api/file-link-actions.js", async () => {
  const actual = await vi.importActual<typeof import("../api/file-link-actions.js")>("../api/file-link-actions.js");
  return { ...actual, savesThroughShareSheet: () => false, saveFileToDevice: save };
});

import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import { Lightbox } from "./Lightbox.js";

beforeEach(() => save.mockReset().mockResolvedValue(undefined));

const GIF = { url: "/api/fs/file-link/download?path=%2Ftmp%2Fstamp.gif&isRelative=0", name: "stamp.gif" };

function image(id: string, download?: ImagePreviewItem["download"]): ImagePreviewItem {
  return {
    id,
    filename: `${id}.gif`,
    thumbnailUrl: `/thumb/${id}`,
    fullUrl: `/full/${id}`,
    sourcePath: `/tmp/${id}.gif`,
    download,
  };
}

async function openViewer(images: ImagePreviewItem[]) {
  render(<ImagePreviewGroup images={images} />);
  for (const preload of screen.getAllByTestId("image-preview-preload")) fireEvent.load(preload);
  fireEvent.click(screen.getByRole("button", { name: `Open image ${images[0]!.filename}` }));
  await screen.findByTestId("image-preview-modal-image");
  return screen.getByTestId("image-preview-modal-path");
}

/**
 * Both image viewers save the image's original file (a GIF stays animated, a plot keeps full
 * resolution), not the compressed copy they show. Before, only the file viewer had Download, and
 * images never open there.
 */
describe("Download in the image viewers", () => {
  it("saves the shown image's original from the thumbnail viewer, beside Copy image", async () => {
    const row = await openViewer([image("stamp", GIF)]);

    fireEvent.click(within(row).getByRole("button", { name: "Download" }));

    expect(save).toHaveBeenCalledWith(GIF);
    expect(screen.getByRole("dialog", { name: "Image preview: stamp.gif" })).toBeVisible();
  });

  it("offers no Download for an image without a file to save", async () => {
    const row = await openViewer([image("unknown")]);
    expect(within(row).queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("saves from the Lightbox without closing it", () => {
    const onClose = vi.fn();
    render(<Lightbox src="/full/stamp" download={GIF} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(save).toHaveBeenCalledWith(GIF);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Download out of a Lightbox whose image has no file", () => {
    render(<Lightbox src="https://example.com/remote.png" onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });
});
