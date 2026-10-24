// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { PhoneTopicFrame } from "./PhoneTopicFrame.js";

/**
 * The phone topic page closes when swiped to the right, the side it came from; a mostly vertical
 * drag is a scroll, not a dismissal.
 */
function swipe(target: Element, from: [number, number], to: [number, number]) {
  fireEvent.touchStart(target, { touches: [{ clientX: from[0], clientY: from[1] }] });
  fireEvent.touchMove(target, { touches: [{ clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 }] });
  fireEvent.touchMove(target, { touches: [{ clientX: to[0], clientY: to[1] }] });
  fireEvent.touchEnd(target, { touches: [] });
}

function renderFrame() {
  const onClose = vi.fn();
  render(
    <PhoneTopicFrame open top={120} onClose={onClose} onHidden={() => {}} frameRef={createRef()}>
      <p>Page</p>
    </PhoneTopicFrame>,
  );
  return onClose;
}

describe("PhoneTopicFrame", () => {
  it("closes the page on a swipe to the right, but not on a vertical scroll", () => {
    const onClose = renderFrame();
    const frame = screen.getByTestId("topic-side-panel");
    swipe(frame, [40, 400], [60, 700]);
    expect(onClose).not.toHaveBeenCalled();
    swipe(frame, [40, 400], [40 + window.innerWidth * 0.5, 410]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
