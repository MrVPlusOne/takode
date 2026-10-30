// @vitest-environment jsdom
/**
 * Focus requests reach the composer they are for: a Reply in a side chat focuses the side chat's
 * message box, while a request naming no composer still goes to the main one only.
 */
import { useRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../store.js";
import { useComposerNavigationFocus } from "./use-composer-navigation-focus.js";

function Box({ draftKey, secondary }: { draftKey: string; secondary?: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useComposerNavigationFocus({
    textareaRef,
    sessionId: "leader",
    threadKey: "main",
    usesTouchKeyboard: false,
    draftKey,
    enabled: !secondary,
  });
  return <textarea ref={textareaRef} aria-label={draftKey} />;
}

afterEach(cleanup);

describe("useComposerNavigationFocus", () => {
  it("focuses the composer a request names, else the main one", () => {
    const sideKey = "leader#side:topic:aaaa0001";
    render(
      <>
        <Box draftKey="leader" />
        <Box draftKey={sideKey} secondary />
      </>,
    );
    act(() => useStore.getState().focusComposer(sideKey));
    expect(document.activeElement).toBe(screen.getByLabelText(sideKey));
    act(() => useStore.getState().focusComposer());
    expect(document.activeElement).toBe(screen.getByLabelText("leader"));
    act(() => useStore.getState().focusComposer("leader"));
    expect(document.activeElement).toBe(screen.getByLabelText("leader"));
  });
});
