import { useState } from "react";
import {
  type SaveableFile,
  ShareNeedsTapError,
  saveFileToDevice,
  savesThroughShareSheet,
} from "../api/file-link-actions.js";

export type SaveState = "idle" | "saving" | "tap-again" | { error: string };

/**
 * Runs a save to the device and tracks it for the button's label: on a phone the file is fetched
 * before the share sheet opens ("saving"), a slow fetch needs another tap ("tap-again"), and a
 * failure says why. A desktop download finishes at once.
 */
export function useSaveToDevice(save: () => Promise<void>): { state: SaveState; run: () => void } {
  const [state, setState] = useState<SaveState>("idle");
  const run = () => {
    if (state === "saving") return;
    setState("saving");
    save().then(
      () => setState("idle"),
      (error: unknown) =>
        setState(
          error instanceof ShareNeedsTapError
            ? "tap-again"
            : { error: error instanceof Error ? error.message : String(error) },
        ),
    );
  };
  return { state, run };
}

/**
 * A viewer's Download button, beside Copy image: saves the file to the device the browser runs
 * on, as a download on a desktop and through the share sheet (Save Image, Save to Files) on a
 * phone, where a download would replace Takode with the system's file page.
 */
export function SaveFileButton({ file, className }: { file: SaveableFile; className: string }) {
  const { state, run } = useSaveToDevice(() => saveFileToDevice(file));
  const label = !savesThroughShareSheet()
    ? "Download"
    : state === "saving"
      ? "Preparing…"
      : state === "tap-again"
        ? "Tap to save"
        : typeof state === "object"
          ? "Save failed"
          : "Save";
  return (
    <button
      type="button"
      className={className}
      disabled={state === "saving"}
      onClick={(event) => {
        event.stopPropagation();
        run();
      }}
      title={typeof state === "object" ? state.error : `${label}: ${file.name}`}
      data-testid="save-file-button"
    >
      {label}
    </button>
  );
}
