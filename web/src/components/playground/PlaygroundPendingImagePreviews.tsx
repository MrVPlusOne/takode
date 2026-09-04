import { useMemo, useState } from "react";
import { ImagePreviewGroup } from "../ImagePreviewGroup.js";
import type { ImagePreviewItem } from "../image-preview-utils.js";

const READY_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTkyIDEyOCI+PHJlY3Qgd2lkdGg9IjE5MiIgaGVpZ2h0PSIxMjgiIHJ4PSIxMiIgZmlsbD0iIzFiMjMzMCIvPjxwYXRoIGQ9Ik0yNCA5Nmw0MC00MCAyOCAyOCAyMC0yMCA1NiA1NnYxNkg0OHoiIGZpbGw9IiM2YWE4ZmYiLz48Y2lyY2xlIGN4PSIxMzYiIGN5PSI0MCIgcj0iMTQiIGZpbGw9IiNmMmM1NzQiLz48L3N2Zz4=";
const MIXED_READY_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTkyIDEyOCI+PHJlY3Qgd2lkdGg9IjE5MiIgaGVpZ2h0PSIxMjgiIHJ4PSIxMiIgZmlsbD0iIzJkMjMzOCIvPjxyZWN0IHg9IjI0IiB5PSIyNCIgd2lkdGg9IjE0NCIgaGVpZ2h0PSI4MCIgcng9IjgiIGZpbGw9IiM0NDRjNWMiLz48cGF0aCBkPSJNNDQgODhsMjgtMjggMjQgMjQgMTYtMTYgMzYgMzZINDR6IiBmaWxsPSIjODVjYTdjIi8+PC9zdmc+";

type PendingState = "pending" | "ready" | "failed";

export function PlaygroundPendingImagePreviews() {
  const [pendingState, setPendingState] = useState<PendingState>("pending");
  const originBrowserImages = useMemo<ImagePreviewItem[]>(
    () => [
      {
        id: "stored:playground:origin-first",
        filename: "origin-first.png",
        thumbnailUrl: READY_IMAGE,
        fullUrl: READY_IMAGE,
        expectedAttachment: true,
        immediatelyAvailable: true,
        localImageId: "origin-first",
        fallback: {
          thumbnailUrl: "/api/images/playground/origin-first/thumb",
          fullUrl: "/api/images/playground/origin-first/full",
        },
      },
      {
        id: "stored:playground:origin-second",
        filename: "origin-second.png",
        thumbnailUrl: MIXED_READY_IMAGE,
        fullUrl: MIXED_READY_IMAGE,
        expectedAttachment: true,
        immediatelyAvailable: true,
        localImageId: "origin-second",
        fallback: {
          thumbnailUrl: "/api/images/playground/origin-second/thumb",
          fullUrl: "/api/images/playground/origin-second/full",
        },
      },
    ],
    [],
  );
  const images = useMemo<ImagePreviewItem[]>(() => {
    const items: ImagePreviewItem[] = [];
    if (pendingState !== "failed") {
      items.push({
        id: "hydrated-pending",
        filename: "mobile-upload.png",
        thumbnailUrl: pendingState === "ready" ? READY_IMAGE : "",
        fullUrl: READY_IMAGE,
        expectedAttachment: true,
      });
    }
    items.push({
      id: "hydrated-ready",
      filename: "already-ready.png",
      thumbnailUrl: MIXED_READY_IMAGE,
      fullUrl: MIXED_READY_IMAGE,
      expectedAttachment: true,
    });
    return items;
  }, [pendingState]);

  return (
    <div className="max-w-sm space-y-4" data-testid="playground-pending-image-demo">
      <div className="space-y-1.5" data-testid="playground-origin-local-image-demo">
        <div className="ml-auto max-w-[calc(100%_-_2rem)] rounded-[14px] rounded-br-[4px] bg-cc-user-bubble px-3 py-2.5 text-cc-fg">
          <ImagePreviewGroup
            images={originBrowserImages}
            className="!mt-0 mb-1"
            testId="playground-origin-local-image-group"
            size="message"
          />
          <p className="text-[13px] sm:text-[14px]">
            These just-uploaded previews survive an authoritative window sync.
          </p>
        </div>
        <p className="text-xs text-cc-muted">
          Origin browser: both local previews stay ready without backend loading tiles.
        </p>
      </div>
      <div className="ml-auto max-w-[calc(100%_-_2rem)] rounded-[14px] rounded-br-[4px] bg-cc-user-bubble px-3 py-2.5 text-cc-fg">
        <ImagePreviewGroup
          images={images}
          className="!mt-0 mb-1"
          testId="playground-pending-image-group"
          size="message"
        />
        <p className="text-[13px] sm:text-[14px]">This message keeps its image slots while mobile previews finish.</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className="rounded-md border border-cc-border bg-cc-card px-2 py-1 text-cc-fg hover:bg-cc-hover disabled:opacity-50"
          onClick={() => setPendingState("ready")}
          disabled={pendingState === "ready"}
        >
          Finish thumbnail
        </button>
        <button
          type="button"
          className="rounded-md border border-cc-border bg-cc-card px-2 py-1 text-cc-fg hover:bg-cc-hover disabled:opacity-50"
          onClick={() => setPendingState("failed")}
          disabled={pendingState === "failed"}
        >
          Mark unavailable
        </button>
        <button
          type="button"
          className="rounded-md border border-cc-border bg-cc-card px-2 py-1 text-cc-fg hover:bg-cc-hover"
          onClick={() => setPendingState("pending")}
        >
          Reset pending
        </button>
      </div>
      <p className="text-xs text-cc-muted" aria-live="polite">
        {pendingState === "pending"
          ? "Mixed state: one known image is loading and one is ready."
          : pendingState === "ready"
            ? "Both known images are ready in their original slots."
            : "The unavailable image settled and disappeared; no spinner remains."}
      </p>
    </div>
  );
}
