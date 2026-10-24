import { useEffect, useState } from "react";

/** How much of a full-size image has arrived, for a viewer to show its size and progress. */
export interface ImageDownload {
  /** URL to display for the requested image; null until its bytes have arrived. */
  displaySrc: string | null;
  receivedBytes: number;
  /** The file's size in bytes, when the server or the URL tells it. */
  totalBytes: number | null;
}

/** Progress updates are spaced out so a fast download does not re-render on every chunk. */
const PROGRESS_INTERVAL_MS = 100;

/**
 * Downloads an image for a full-size viewer, which an `<img>` cannot report on: same-origin
 * images are fetched with progress and displayed from an object URL of the received bytes,
 * so they download once. A local `blob:` preview is already in memory, so it shows at once
 * while its size is looked up, and a `data:` URL's size is read from the URL itself. Other
 * origins, and downloads that fail, fall back to the plain URL, which the `<img>` loads
 * itself (and shows broken when it is). Changing `src` abandons the previous download, so a
 * quick run of Previous/Next only finishes the image that ends up selected.
 */
export function useImageDownload(src: string): ImageDownload {
  const [download, setDownload] = useState<ImageDownload & { src: string }>(() => ({
    src,
    ...initialDownload(src),
  }));

  useEffect(() => {
    const local = src.startsWith("blob:");
    if (!local && !isSameOriginHttp(src)) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const update = (next: ImageDownload) => {
      if (!controller.signal.aborted) setDownload({ src, ...next });
    };
    const warn = (message: string, error: unknown) => {
      if (!controller.signal.aborted) console.warn(`[image-viewer] ${message}`, src, error);
    };

    if (local) {
      fetch(src, { signal: controller.signal })
        .then((response) => response.blob())
        .then((blob) => update({ displaySrc: src, receivedBytes: blob.size, totalBytes: blob.size }))
        .catch((error: unknown) => warn("Could not read the local image's size", error));
      return () => controller.abort();
    }

    fetchWithProgress(src, controller.signal, (receivedBytes, totalBytes) =>
      update({ displaySrc: null, receivedBytes, totalBytes }),
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        update({ displaySrc: objectUrl, receivedBytes: blob.size, totalBytes: blob.size });
      })
      .catch((error: unknown) => {
        warn("Download failed; loading the image directly", error);
        update({ displaySrc: src, receivedBytes: 0, totalBytes: null });
      });

    return () => {
      controller.abort();
      // An image element that already shows these bytes keeps them after the URL is revoked.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  // Until the effect catches up with a new src, report that image's initial state, never the previous image's.
  const { src: downloadSrc, ...current } = download;
  return downloadSrc === src ? current : initialDownload(src);
}

/**
 * "0.4 / 1.2 MB" while downloading ("Loading…" before anything is known), "1.2 MB" once
 * done; null for a downloaded image whose size is unknown. Progress uses the total's unit,
 * so it stays short enough for a phone's header.
 */
export function formatImageDownload({ displaySrc, receivedBytes, totalBytes }: ImageDownload): string | null {
  if (displaySrc !== null) return totalBytes === null ? null : formatBytes(totalBytes);
  if (totalBytes !== null) {
    const unit = byteUnit(totalBytes);
    return `${formatInUnit(receivedBytes, unit)} / ${formatInUnit(totalBytes, unit)} ${unit.label}`;
  }
  return receivedBytes > 0 ? formatBytes(receivedBytes) : "Loading…";
}

function initialDownload(src: string): ImageDownload {
  if (isSameOriginHttp(src)) return { displaySrc: null, receivedBytes: 0, totalBytes: null };
  const totalBytes = dataUrlBytes(src);
  return { displaySrc: src, receivedBytes: totalBytes ?? 0, totalBytes };
}

function isSameOriginHttp(src: string): boolean {
  if (!src) return false;
  try {
    const url = new URL(src, window.location.href);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function fetchWithProgress(
  src: string,
  signal: AbortSignal,
  onProgress: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<Blob> {
  const response = await fetch(src, { signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  // A compressed response's Content-Length counts compressed bytes, not the ones read below.
  const length = response.headers.get("Content-Encoding") ? null : Number(response.headers.get("Content-Length"));
  const totalBytes = length && Number.isFinite(length) ? length : null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  let reportedAt = 0;
  onProgress(0, totalBytes);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.byteLength;
    if (Date.now() - reportedAt >= PROGRESS_INTERVAL_MS) {
      reportedAt = Date.now();
      onProgress(receivedBytes, totalBytes);
    }
  }
  return new Blob(chunks as BlobPart[], { type: response.headers.get("Content-Type") ?? "" });
}

function dataUrlBytes(src: string): number | null {
  const match = /^data:[^,]*?(;base64)?,/i.exec(src);
  if (!match) return null;
  const payload = src.slice(match[0].length);
  if (!match[1]) return decodeURIComponentSafe(payload).length;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

interface ByteUnit {
  label: "B" | "KB" | "MB";
  bytes: number;
  decimals: number;
}

function byteUnit(bytes: number): ByteUnit {
  if (bytes < 1024) return { label: "B", bytes: 1, decimals: 0 };
  if (bytes < 1024 * 1024) return { label: "KB", bytes: 1024, decimals: 0 };
  return { label: "MB", bytes: 1024 * 1024, decimals: 1 };
}

function formatInUnit(bytes: number, unit: ByteUnit): string {
  return (bytes / unit.bytes).toFixed(unit.decimals);
}

function formatBytes(bytes: number): string {
  const unit = byteUnit(bytes);
  return `${formatInUnit(bytes, unit)} ${unit.label}`;
}
