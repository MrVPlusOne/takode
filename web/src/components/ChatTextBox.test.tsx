// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { ChatTextBox } from "./ChatTextBox.js";
import { setChatTextBoxMode, setUnchosenChatTextBoxModeForTest } from "./chat-text-box-mode.js";

// Every chat input renders through ChatTextBox: the Markdown box by default, or a plain textarea
// when the Message Box setting is Plain. These tests pin the setting, that references are
// highlighted in the Markdown box, and that a box without its own draft history still undoes.
// (The shared test setup makes unchosen browsers plain; these tests set what they need.)

function Box({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <ChatTextBox aria-label="Answer" value={value} onChange={(event) => setValue(event.target.value)} />;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setUnchosenChatTextBoxModeForTest("plain");
});

it("is the Markdown box unless the browser chose Plain", () => {
  setUnchosenChatTextBoxModeForTest("markdown");
  render(<Box initial="hi #5" />);
  const box = screen.getByLabelText("Answer");
  expect(box.getAttribute("contenteditable")).toBe("plaintext-only");
  expect(box.hasAttribute("data-chat-input")).toBe(true);
  expect(box.querySelector(".md-ref")?.textContent).toBe("#5");
  act(() => setChatTextBoxMode("plain"));
  expect(screen.getByLabelText("Answer").tagName).toBe("TEXTAREA");
});

it("keeps Plain for a browser that chose today's box during the preview", () => {
  setUnchosenChatTextBoxModeForTest("markdown");
  localStorage.setItem("cc-composer-text-box-preview", "textarea");
  render(<Box />);
  expect(screen.getByLabelText("Answer").tagName).toBe("TEXTAREA");
});

it("undoes and redoes on its own when the draft keeps no history", () => {
  setChatTextBoxMode("markdown");
  render(<Box initial="one" />);
  const box = screen.getByLabelText("Answer") as HTMLElement & { value: string };
  act(() => {
    box.value = "one two";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(box.value).toBe("one two");
  fireEvent.keyDown(box, { key: "z", ctrlKey: true });
  expect(box.value).toBe("one");
  fireEvent.keyDown(box, { key: "z", ctrlKey: true, shiftKey: true });
  expect(box.value).toBe("one two");
});

it("opens a reference on Cmd/Ctrl+click and shows its card on hover, but a plain click only edits", async () => {
  const routing = await import("../utils/routing.js");
  const open = vi.spyOn(routing, "openQuestOverlayRouteAware").mockImplementation(() => {});
  const go = vi.spyOn(routing, "navigateToSession").mockImplementation(() => {});
  useStore.setState({ sdkSessions: [{ sessionId: "s3", sessionNum: 3, state: "idle", cwd: "/tmp" } as never] });
  setChatTextBoxMode("markdown");
  render(<Box initial="see q-5 and #3" />);
  const [quest, session] = Array.from(screen.getByLabelText("Answer").querySelectorAll<HTMLElement>(".md-ref"));

  fireEvent.click(quest!);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(quest!, { metaKey: true });
  expect(open).toHaveBeenCalledWith("q-5");
  fireEvent.click(session!, { ctrlKey: true });
  expect(go).toHaveBeenCalledWith("s3");

  // Hovering the session link shows the same card a session link in the feed does.
  fireEvent.pointerMove(session!);
  expect(await screen.findByTestId("session-hover-card")).toBeTruthy();
  vi.restoreAllMocks();
});
