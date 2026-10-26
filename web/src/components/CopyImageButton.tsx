import { useEffect, useState } from "react";
import { canWriteClipboardImage, writeClipboardImage } from "../utils/copy-utils.js";

type CopyState = "idle" | "copied" | "failed";

const LABELS: Record<CopyState, string> = {
  idle: "Copy image",
  copied: "Copied",
  failed: "Copy failed",
};

/**
 * A full-size viewer's "Copy image" button: puts the image itself on the clipboard, so it pastes into
 * Slack and other apps as an image. Disabled while `src` is null (the image is still downloading) and not
 * shown in browsers that cannot copy images, such as a phone opening Takode over plain HTTP.
 */
export function CopyImageButton({ src, className }: { src: string | null; className: string }) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(timer);
  }, [state]);

  if (!canWriteClipboardImage()) return null;

  return (
    <button
      type="button"
      className={className}
      disabled={src === null}
      onClick={(event) => {
        event.stopPropagation();
        if (src === null) return;
        writeClipboardImage(src)
          .then(() => setState("copied"))
          .catch((error: unknown) => {
            console.warn("[image-viewer] Could not copy the image", src, error);
            setState("failed");
          });
      }}
      data-testid="copy-image-button"
    >
      {LABELS[state]}
    </button>
  );
}
