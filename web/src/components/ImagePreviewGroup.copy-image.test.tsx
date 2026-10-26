// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ImagePreviewItem } from "./image-preview-utils.js";

// The clipboard itself is covered in copy-utils.test.ts; here the viewers only need to hand it the shown image.
const clipboard = vi.hoisted(() => ({
  supported: true,
  writeImage: vi.fn(async (_src: string) => undefined),
}));
vi.mock("../utils/copy-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/copy-utils.js")>("../utils/copy-utils.js");
  return {
    ...actual,
    canWriteClipboardImage: () => clipboard.supported,
    writeClipboardImage: (src: string) => clipboard.writeImage(src),
  };
});

import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import { Lightbox } from "./Lightbox.js";

beforeEach(() => {
  clipboard.supported = true;
  clipboard.writeImage.mockReset();
  clipboard.writeImage.mockResolvedValue(undefined);
});

function image(id: string, sourcePath?: string): ImagePreviewItem {
  return {
    id,
    filename: `${id}.png`,
    thumbnailUrl: `/thumb/${id}.png`,
    fullUrl: `/full/${id}.png`,
    sourcePath,
  };
}

async function openViewer(images: ImagePreviewItem[]) {
  render(<ImagePreviewGroup images={images} />);
  for (const preload of screen.getAllByTestId("image-preview-preload")) fireEvent.load(preload);
  fireEvent.click(screen.getByRole("button", { name: `Open image ${images[0]!.filename}` }));
  // jsdom cannot download, so the viewer settles on the plain URL; Copy image waits for that.
  await screen.findByTestId("image-preview-modal-image");
  return screen.getByTestId("image-preview-modal-path");
}

describe("Copy image in the image viewers", () => {
  it("copies the shown image from the thumbnail viewer, next to Copy path", async () => {
    const row = await openViewer([image("plot", "/tmp/plots/plot.png")]);

    expect(within(row).getByRole("button", { name: "Copy image path" })).toHaveTextContent("Copy path");
    fireEvent.click(within(row).getByRole("button", { name: "Copy image" }));

    expect(clipboard.writeImage).toHaveBeenCalledWith("/full/plot.png");
    expect(await within(row).findByText("Copied")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Image preview: plot.png" })).toBeVisible();
  });

  it("offers Copy image for images without a file path", async () => {
    // Uploaded attachments have no path, so the row holds only the image copy.
    const row = await openViewer([image("upload")]);

    expect(within(row).queryByRole("button", { name: "Copy image path" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Copy image" }));
    expect(clipboard.writeImage).toHaveBeenCalledWith("/full/upload.png");
  });

  it("says so when the copy fails", async () => {
    clipboard.writeImage.mockRejectedValue(new Error("denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = await openViewer([image("plot", "/tmp/plots/plot.png")]);

    fireEvent.click(within(row).getByRole("button", { name: "Copy image" }));

    expect(await within(row).findByText("Copy failed")).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("hides Copy image, and a path-less row, where the browser cannot copy images", async () => {
    clipboard.supported = false;
    render(<ImagePreviewGroup images={[image("upload")]} />);
    fireEvent.load(screen.getByTestId("image-preview-preload"));
    fireEvent.click(screen.getByRole("button", { name: "Open image upload.png" }));
    await screen.findByTestId("image-preview-modal-image");

    expect(screen.queryByRole("button", { name: "Copy image" })).toBeNull();
    expect(screen.queryByTestId("image-preview-modal-path")).toBeNull();
  });

  it("copies from the Lightbox without closing it", () => {
    const onClose = vi.fn();
    render(<Lightbox src="data:image/png;base64,abc123" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));

    expect(clipboard.writeImage).toHaveBeenCalledWith("data:image/png;base64,abc123");
    expect(onClose).not.toHaveBeenCalled();
  });
});
