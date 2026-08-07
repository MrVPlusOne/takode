// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  findVisibleFeedAnchorInContainer,
  findVisibleMessageAnchorInContainer,
  findVisiblePreviousAnchorForPersistence,
  isSystemErrorMessageAnchor,
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
});
