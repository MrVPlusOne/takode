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
        offsetBeforeRestore: 120,
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
