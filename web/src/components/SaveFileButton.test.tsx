// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const device = vi.hoisted(() => ({
  phone: false,
  save: vi.fn(async (_file: { url: string; name: string }) => undefined),
}));
vi.mock("../api/file-link-actions.js", async () => {
  const actual = await vi.importActual<typeof import("../api/file-link-actions.js")>("../api/file-link-actions.js");
  return {
    ...actual,
    savesThroughShareSheet: () => device.phone,
    saveFileToDevice: (file: { url: string; name: string }) => device.save(file),
  };
});

import { ShareNeedsTapError } from "../api/file-link-actions.js";
import { SaveFileButton } from "./SaveFileButton.js";

const FILE = { url: "/api/fs/file-link/download?path=%2Ftmp%2Fstamp.gif&isRelative=0", name: "stamp.gif" };

beforeEach(() => {
  device.phone = false;
  device.save.mockReset().mockResolvedValue(undefined);
});

/**
 * The viewers' Download: a plain download on a desktop; on a phone, Save through the share sheet,
 * whose slow fetch can need a second tap and whose failure must say so rather than vanish.
 */
describe("SaveFileButton", () => {
  it("downloads the file on a desktop", () => {
    render(<SaveFileButton file={FILE} className="" />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(device.save).toHaveBeenCalledWith(FILE);
  });

  it("asks for another tap on a phone when the share sheet needs one, then saves on it", async () => {
    device.phone = true;
    device.save.mockRejectedValueOnce(new ShareNeedsTapError());
    render(<SaveFileButton file={FILE} className="" />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tap to save" }));

    expect(device.save).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("says why a save failed", async () => {
    device.phone = true;
    device.save.mockRejectedValueOnce(new Error("Host devbox is offline"));
    render(<SaveFileButton file={FILE} className="" />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Save failed" })).toHaveAttribute(
      "title",
      "Host devbox is offline",
    );
  });
});
