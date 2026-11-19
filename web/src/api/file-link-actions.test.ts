// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareNeedsTapError, downloadFileLink, nameForType, savesThroughShareSheet } from "./file-link-actions.js";

/**
 * Saving a linked file to the device. A download in the iPhone Home Screen app replaces Takode
 * with the system's file page and has no way back, so phones save through the share sheet
 * (Save Video, Save Image, Save to Files) and desktops keep the plain download.
 */
describe("downloadFileLink", () => {
  const share = vi.fn();
  const fetchMock = vi.fn();
  let touch = true;

  beforeEach(() => {
    touch = true;
    share.mockReset().mockResolvedValue(undefined);
    fetchMock.mockReset().mockImplementation(async () => new Response("video-bytes"));
    vi.stubGlobal("fetch", fetchMock);
    window.matchMedia = ((query: string) => ({ matches: touch && query.includes("pointer: coarse") })) as never;
    Object.assign(navigator, { canShare: () => true, share });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads on a desktop", async () => {
    touch = false;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(savesThroughShareSheet()).toBe(false);
    await downloadFileLink({ path: "/media/clip.mp4", isRelative: false, sessionId: "s1" });
    expect(click).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
  });

  // The share sheet offers Save Video only for a file typed as video, while the download route
  // sends every file as untyped data, so the shared file takes its type from its name.
  it("shares the file as a typed video on a phone", async () => {
    await downloadFileLink({ path: "/media/clip.mp4", isRelative: false, sessionId: "s1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fs/file-link/download?path=%2Fmedia%2Fclip.mp4&isRelative=0&sessionId=s1",
    );
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    expect(files[0]!.name).toBe("clip.mp4");
    expect(files[0]!.type).toBe("video/mp4");
  });

  // A slow fetch outlasts the tap's permission to open the share sheet. The fetched file is kept,
  // so the next tap opens the sheet without fetching again; closing the sheet is not an error.
  it("asks for another tap after a slow fetch and shares the kept file on it", async () => {
    share.mockRejectedValueOnce(new DOMException("no activation", "NotAllowedError"));
    const target = { path: "/media/slow.mov", isRelative: false };
    await expect(downloadFileLink(target)).rejects.toBeInstanceOf(ShareNeedsTapError);
    await downloadFileLink(target);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(2);

    share.mockRejectedValueOnce(new DOMException("closed", "AbortError"));
    await expect(downloadFileLink(target)).resolves.toBeUndefined();
  });
});

/** A stored copy kept in another format than its upload is saved under its own type's extension. */
describe("nameForType", () => {
  it("keeps a name that matches the type and swaps one that does not", () => {
    expect(nameForType("stamp.gif", "image/gif")).toBe("stamp.gif");
    expect(nameForType("photo.jpg", "image/jpeg")).toBe("photo.jpg");
    expect(nameForType("Screenshot.png", "image/webp")).toBe("Screenshot.webp");
    expect(nameForType("1795049267731-16-bfb13e", "image/png")).toBe("1795049267731-16-bfb13e.png");
    // A type with no known extension leaves the name alone.
    expect(nameForType("diagram.svg", "image/svg+xml")).toBe("diagram.svg");
  });
});
