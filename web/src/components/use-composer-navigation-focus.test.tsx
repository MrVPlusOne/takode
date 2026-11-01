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

  it("focuses a composer asked for before it appeared, once", async () => {
    // New in the sessions panel opens a leader's Home and asks its message box to take focus;
    // the box mounts after the navigation.
    act(() => useStore.getState().focusComposer("leader#side:home", { whenShown: true }));
    const first = render(<Box draftKey="leader#side:home" />);
    // A frame later, once the view that brought it has settled.
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(document.activeElement).toBe(screen.getByLabelText("leader#side:home"));
    first.unmount();
    // Shown again later: the request was used up.
    render(<Box draftKey="leader#side:home" />);
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(document.activeElement).not.toBe(screen.getByLabelText("leader#side:home"));
  });
});
