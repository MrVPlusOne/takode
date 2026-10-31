// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  purgeStoredDataThumbnails,
  rememberThumbnailLoaded,
  resetThumbnailLoadMemoryForTest,
  wasThumbnailLoaded,
} from "./image-thumbnail-load-memory.js";

const STORED_KEY = "srv:cc-loaded-image-thumbnails";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "srv");
  resetThumbnailLoadMemoryForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

function stored(): unknown {
  return JSON.parse(localStorage.getItem(STORED_KEY) ?? "null");
}

describe("image thumbnail load memory", () => {
  it("remembers server thumbnail URLs across page loads", () => {
    // The point of the memory: a thumbnail loaded once shows at once after a reload.
    rememberThumbnailLoaded("/api/images/s1/img/thumb");
    vi.advanceTimersByTime(1_000);
    expect(stored()).toEqual(["/api/images/s1/img/thumb"]);

    resetThumbnailLoadMemoryForTest();
    localStorage.setItem(STORED_KEY, JSON.stringify(["/api/images/s1/img/thumb"]));
    expect(wasThumbnailLoaded("/api/images/s1/img/thumb")).toBe(true);
  });

  it("never stores data or blob URLs", () => {
    // Pasted attachments preview through data URLs that hold the whole image.
    // Remembering them filled the browser's localStorage quota (one entry was
    // 1.2 MB), after which every localStorage write threw and crashed the app.
    rememberThumbnailLoaded(`data:image/png;base64,${"A".repeat(10_000)}`);
    rememberThumbnailLoaded("blob:http://localhost/123");
    rememberThumbnailLoaded("/api/images/s1/img/thumb");
    vi.advanceTimersByTime(1_000);
    expect(stored()).toEqual(["/api/images/s1/img/thumb"]);
  });

  it("drops data URLs that earlier builds stored and gives the space back", () => {
    // Browsers already holding megabytes of data URLs clean themselves up on
    // the first read, without waiting for a new thumbnail to load.
    localStorage.setItem(
      STORED_KEY,
      JSON.stringify(["/api/images/s1/a/thumb", `data:image/png;base64,${"A".repeat(10_000)}`]),
    );
    expect(wasThumbnailLoaded("/api/images/s1/a/thumb")).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(stored()).toEqual(["/api/images/s1/a/thumb"]);
  });

  it("drops stored data URLs from every server's entry at startup, freeing a full storage", () => {
    // A full storage (pasted images remembered by earlier builds) makes every other save fail, such as
    // a folded section. Entries kept for other servers are never read again, so nothing else frees them.
    const pasted = `data:image/png;base64,${"A".repeat(1000)}`;
    localStorage.setItem(STORED_KEY, JSON.stringify(["/api/images/s1/a/thumb", pasted]));
    localStorage.setItem("old-srv:cc-loaded-image-thumbnails", JSON.stringify([pasted]));
    localStorage.setItem("other:cc-loaded-image-thumbnails", JSON.stringify(["/api/images/s2/b/thumb"]));
    purgeStoredDataThumbnails();
    expect(stored()).toEqual(["/api/images/s1/a/thumb"]);
    expect(localStorage.getItem("old-srv:cc-loaded-image-thumbnails")).toBeNull();
    expect(localStorage.getItem("other:cc-loaded-image-thumbnails")).toBe(JSON.stringify(["/api/images/s2/b/thumb"]));
  });
});
