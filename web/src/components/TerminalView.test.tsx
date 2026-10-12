// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { setTouchDeviceForTest } from "./test-match-media.js";

// The terminal's paste menu. On touch screens a long-press over the terminal
// must offer Paste: iOS shows no menu of its own there, because xterm types
// through a tiny hidden textarea that a long-press never lands on.

const pasted: string[] = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    loadAddon() {}
    open() {}
    onData() {
      return { dispose() {} };
    }
    write() {}
    writeln() {}
    dispose() {}
    paste(text: string) {
      pasted.push(text);
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../api.js", () => ({
  api: {
    getTerminal: () => new Promise(() => {}),
    spawnTerminal: vi.fn(),
  },
}));
vi.mock("../terminal-ws.js", () => ({
  connectTerminal: vi.fn(),
  sendTerminalInput: vi.fn(),
  sendTerminalResize: vi.fn(),
  disconnectTerminal: vi.fn(),
}));
vi.mock("../store.js", () => {
  const state = { colorTheme: "dark", setTerminalId: vi.fn() };
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  useStore.getState = () => state;
  return { useStore };
});

import { TerminalView } from "./TerminalView.js";

beforeEach(() => {
  pasted.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const terminalSurface = () => screen.getByTestId("terminal-surface");

describe("TerminalView paste menu", () => {
  it("opens Paste on a touch long-press and pastes the clipboard into the terminal", async () => {
    setTouchDeviceForTest(true);
    const readText = vi.fn().mockResolvedValue("https://example.test/callback?code=abc");
    vi.stubGlobal("navigator", { ...navigator, clipboard: { readText } });
    vi.useFakeTimers();
    render(<TerminalView cwd="/tmp/project" embedded />);

    fireEvent.touchStart(terminalSurface(), {
      touches: [{ clientX: 50, clientY: 120 }],
    });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(terminalSurface());
    // The menu opens under the finger, not below the full-height terminal.
    const paste = screen.getByRole("button", { name: "Paste" });
    expect((paste.closest(".fixed") as HTMLElement).style.top).toBe("124px");

    // The clipboard is read inside the tap itself, which iOS requires.
    fireEvent.click(paste);
    expect(readText).toHaveBeenCalledTimes(1);
    await act(async () => {});
    // xterm's paste() applies bracketed paste and line-ending handling.
    expect(pasted).toEqual(["https://example.test/callback?code=abc"]);
    expect(screen.queryByRole("button", { name: "Paste" })).toBeNull();
  });

  it("keeps the browser's own right-click menu on desktop", () => {
    setTouchDeviceForTest(false);
    vi.useFakeTimers();
    render(<TerminalView cwd="/tmp/project" embedded />);

    const contextMenu = createEvent.contextMenu(terminalSurface());
    fireEvent(terminalSurface(), contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);
    fireEvent.touchStart(terminalSurface(), {
      touches: [{ clientX: 50, clientY: 120 }],
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("button", { name: "Paste" })).toBeNull();
  });
});
