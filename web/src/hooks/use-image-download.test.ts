// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { formatImageDownload, useImageDownload } from "./use-image-download.js";

// The image viewer shows an image's size and download progress, which an <img> cannot
// report, so same-origin images are downloaded with fetch and shown from an object URL.

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

/** A response whose body arrives in chunks the test releases one at a time. */
function streamedResponse(totalBytes: number, headers: Record<string, string> = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const response = new Response(body, {
    headers: { "Content-Type": "image/png", "Content-Length": String(totalBytes), ...headers },
  });
  return {
    response,
    send: (bytes: number) => controller.enqueue(new Uint8Array(bytes)),
    finish: () => controller.close(),
  };
}

beforeEach(() => {
  let next = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:download-${++next}`);
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useImageDownload", () => {
  it("reports progress against Content-Length, then shows the downloaded bytes", async () => {
    const stream = streamedResponse(3 * 1024 * 1024);
    const fetchMock = vi.fn(async () => stream.response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImageDownload("/api/images/s/a/full"));
    expect(result.current).toEqual({ displaySrc: null, receivedBytes: 0, totalBytes: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/images/s/a/full",
      expect.objectContaining({ signal: expect.anything() }),
    );

    await act(async () => stream.send(1024 * 1024));
    await waitFor(() => expect(result.current.receivedBytes).toBe(1024 * 1024));
    expect(formatImageDownload(result.current)).toBe("1.0 / 3.0 MB");

    await act(async () => {
      stream.send(2 * 1024 * 1024);
      stream.finish();
    });
    await waitFor(() => expect(result.current.displaySrc).toBe("blob:download-1"));
    expect(result.current.totalBytes).toBe(3 * 1024 * 1024);
    expect(formatImageDownload(result.current)).toBe("3.0 MB");
  });

  it("abandons the previous download when the image changes, so it cannot land late", async () => {
    // Previous/Next in quick succession: only the last requested image may show.
    const first = streamedResponse(100);
    const second = streamedResponse(200);
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return signals.length === 1 ? first.response : second.response;
      }),
    );

    const { result, rerender } = renderHook(({ src }) => useImageDownload(src), { initialProps: { src: "/a.png" } });
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({ src: "/b.png" });
    // The new image never reports the previous one's state, even before its effect runs.
    expect(result.current).toEqual({ displaySrc: null, receivedBytes: 0, totalBytes: null });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);

    await act(async () => {
      second.send(200);
      second.finish();
    });
    await waitFor(() => expect(result.current.displaySrc).toBe("blob:download-1"));
    expect(result.current.totalBytes).toBe(200);
  });

  it("revokes its object URL when the image changes or the viewer closes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(10))),
    );
    const { result, rerender, unmount } = renderHook(({ src }) => useImageDownload(src), {
      initialProps: { src: "/a.png" },
    });
    await waitFor(() => expect(result.current.displaySrc).toBe("blob:download-1"));

    rerender({ src: "/b.png" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download-1");
    await waitFor(() => expect(result.current.displaySrc).toBe("blob:download-2"));

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download-2");
  });

  it("falls back to the plain URL when the download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    const { result } = renderHook(() => useImageDownload("/a.png"));
    await waitFor(() => expect(result.current.displaySrc).toBe("/a.png"));
    expect(result.current.totalBytes).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("lets the image element load other origins itself", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useImageDownload("https://example.com/a.png"));
    expect(result.current).toEqual({ displaySrc: "https://example.com/a.png", receivedBytes: 0, totalBytes: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(formatImageDownload(result.current)).toBeNull();
  });

  it("reads a data URL's size from the URL", () => {
    // "abcd" is 4 base64 characters, 3 bytes; "YQ==" is one byte with two padding characters.
    expect(renderHook(() => useImageDownload("data:image/png;base64,abcdYQ==")).result.current).toEqual({
      displaySrc: "data:image/png;base64,abcdYQ==",
      receivedBytes: 4,
      totalBytes: 4,
    });
  });

  it("shows a local blob preview at once and looks up its size", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(2048))),
    );
    const { result } = renderHook(() => useImageDownload("blob:local-preview"));
    expect(result.current.displaySrc).toBe("blob:local-preview");
    await waitFor(() => expect(result.current.totalBytes).toBe(2048));
    expect(result.current.displaySrc).toBe("blob:local-preview");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(formatImageDownload(result.current)).toBe("2 KB");
  });
});

describe("formatImageDownload", () => {
  it("says Loading until anything is known, and counts bytes without a known size", () => {
    expect(formatImageDownload({ displaySrc: null, receivedBytes: 0, totalBytes: null })).toBe("Loading…");
    expect(formatImageDownload({ displaySrc: null, receivedBytes: 512, totalBytes: null })).toBe("512 B");
    expect(formatImageDownload({ displaySrc: null, receivedBytes: 0, totalBytes: 50 * 1024 })).toBe("0 / 50 KB");
  });
});
