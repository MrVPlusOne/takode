// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  findVisibleFeedAnchorInContainer,
  findVisibleMessageAnchorInContainer,
  findVisiblePreviousAnchorForPersistence,
  isSystemErrorMessageAnchor,
  schedulePostLayoutViewportAnchorRestore,
} from "./message-feed-viewport-anchor.js";

function setRect(element: Element, top: number, bottom: number): void {
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: top, width: 600, height: bottom - top });
}

describe("message-feed viewport anchors", () => {
  it("skips ordinary error rows for saved viewport snapshots while preserving explicit error targets", () => {
    const container = document.createElement("div");
    setRect(container, 0, 400);

    const error = document.createElement("div");
    error.dataset.messageId = "hist-error-1";
    error.dataset.messageRole = "system";
    error.dataset.messageVariant = "error";
    setRect(error, 40, 120);
    container.appendChild(error);

    const assistant = document.createElement("div");
    assistant.dataset.messageId = "assistant-visible";
    assistant.dataset.messageRole = "assistant";
    setRect(assistant, 150, 220);
    container.appendChild(assistant);

    expect(findVisibleFeedAnchorInContainer(container)?.messageId).toBe("assistant-visible");
    expect(findVisibleMessageAnchorInContainer(container, "hist-error-1")?.messageId).toBe("hist-error-1");
    expect(
      findVisiblePreviousAnchorForPersistence({
        container,
        previousAnchorId: "hist-error-1",
        explicitTargetId: null,
      }),
    ).toBeNull();
    expect(
      findVisiblePreviousAnchorForPersistence({
        container,
        previousAnchorId: "hist-error-1",
        explicitTargetId: "hist-error-1",
      })?.messageId,
    ).toBe("hist-error-1");
    expect(isSystemErrorMessageAnchor(container, "hist-error-1")).toBe(true);
    expect(isSystemErrorMessageAnchor(container, "assistant-visible")).toBe(false);
  });

  it("retries when a late layout restore rolls the saved anchor back before the first frame", () => {
    // MessageFeed restores the durable anchor synchronously, but a later layout
    // signature effect in the same commit can restore the pre-hydration anchor.
    // Seeing the pre-restore offset on the first frame is therefore evidence of
    // rollback, not settlement; the saved offset must win before completion.
    const container = document.createElement("div") as HTMLDivElement;
    setRect(container, 0, 400);
    const savedAnchor = document.createElement("div");
    savedAnchor.dataset.messageId = "msg-130";
    let anchorTop = 1300;
    savedAnchor.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: anchorTop, width: 600, height: 80 });
    container.appendChild(savedAnchor);

    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const restore = vi.fn(() => {
      anchorTop = 100;
      return true;
    });
    const settledOffsets: number[] = [];

    try {
      // The caller already performed the synchronous restore before scheduling
      // post-layout verification.
      anchorTop = 100;
      schedulePostLayoutViewportAnchorRestore({
        container: { current: container },
        position: {
          scrollTop: 12900,
          scrollHeight: 14000,
          isAtBottom: false,
          anchorMessageId: "msg-130",
          anchorTurnId: "msg-130",
          anchorOffsetTop: 100,
        },
        restore,
        onSettled: () => settledOffsets.push(anchorTop),
      });

      // A later layout-signature restore puts the old viewport back before the
      // queued verification frame runs.
      container.scrollTop = 12900;
      anchorTop = 1300;
      container.scrollTop = 11700;
      while (frames.length > 0) frames.shift()?.(0);

      expect(restore).toHaveBeenCalled();
      expect(anchorTop).toBe(100);
      expect(settledOffsets).toEqual([100]);
    } finally {
      requestFrame.mockRestore();
    }
  });

  it("restores the visible anchor after historical attachment content is inserted above it", () => {
    // A selected quest can gain older attached rows after completion is visible;
    // layout settling must keep that completion at the same viewport offset.
    const container = document.createElement("div") as HTMLDivElement;
    setRect(container, 0, 400);
    const completion = document.createElement("div");
    completion.dataset.messageId = "completion";
    let completionTop = 120;
    completion.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: completionTop, width: 600, height: 80 });
    container.appendChild(completion);

    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const restore = vi.fn(() => {
      completionTop = 120;
      return true;
    });
    const settled = vi.fn();

    try {
      schedulePostLayoutViewportAnchorRestore({
        container: { current: container },
        position: {
          scrollTop: 1000,
          scrollHeight: 4000,
          isAtBottom: false,
          anchorMessageId: "completion",
          anchorTurnId: "completion-turn",
          anchorOffsetTop: 120,
        },
        restore,
        onSettled: settled,
      });

      completionTop = 360;
      frames.shift()?.(0);
      frames.shift()?.(0);

      expect(restore).toHaveBeenCalledTimes(2);
      expect(completionTop).toBe(120);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      requestFrame.mockRestore();
    }
  });
});
