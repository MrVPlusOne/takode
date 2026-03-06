import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VSCODE_CONTEXT_MESSAGE_TYPE,
  VSCODE_CONTEXT_SOURCE,
  VSCODE_READY_MESSAGE_TYPE,
  announceVsCodeReady,
  appendVsCodeContext,
  isVsCodeSelectionContextPayload,
  maybeReadVsCodeSelectionContext,
} from "./vscode-context.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("appendVsCodeContext", () => {
  it("appends the VS Code metadata line when enabled", () => {
    expect(
      appendVsCodeContext(
        "Investigate this regression",
        {
          label: "Cursor: web/src/App.tsx:42:7",
          messageSuffix: "[user cursor in VSCode: web/src/App.tsx:42:7] (this may or may not be relevant)",
          updatedAt: 1,
        },
        true,
      ),
    ).toBe(
      "Investigate this regression\n\n[user cursor in VSCode: web/src/App.tsx:42:7] (this may or may not be relevant)",
    );
  });

  it("leaves the message untouched when disabled", () => {
    expect(
      appendVsCodeContext(
        "Investigate this regression",
        {
          label: "Cursor: web/src/App.tsx:42:7",
          messageSuffix: "[user cursor in VSCode: web/src/App.tsx:42:7] (this may or may not be relevant)",
          updatedAt: 1,
        },
        false,
      ),
    ).toBe("Investigate this regression");
  });
});

describe("isVsCodeSelectionContextPayload", () => {
  it("accepts the extension payload shape", () => {
    expect(
      isVsCodeSelectionContextPayload({
        label: "Cursor: web/src/App.tsx:42:7",
        messageSuffix: "[user cursor in VSCode: web/src/App.tsx:42:7] (this may or may not be relevant)",
      }),
    ).toBe(true);
  });

  it("rejects incomplete payloads", () => {
    expect(isVsCodeSelectionContextPayload({ label: "Cursor only" })).toBe(false);
  });
});

describe("maybeReadVsCodeSelectionContext", () => {
  it("extracts a valid extension payload", () => {
    expect(
      maybeReadVsCodeSelectionContext({
        source: VSCODE_CONTEXT_SOURCE,
        type: VSCODE_CONTEXT_MESSAGE_TYPE,
        payload: {
          label: "Cursor: web/src/App.tsx:42:7",
          messageSuffix: "[user cursor in VSCode: web/src/App.tsx:42:7] (this may or may not be relevant)",
        },
      }),
    ).toEqual({
      label: "Cursor: web/src/App.tsx:42:7",
      messageSuffix: "[user cursor in VSCode: web/src/App.tsx:42:7] (this may or may not be relevant)",
    });
  });

  it("returns null when the extension explicitly clears context", () => {
    expect(
      maybeReadVsCodeSelectionContext({
        source: VSCODE_CONTEXT_SOURCE,
        type: VSCODE_CONTEXT_MESSAGE_TYPE,
        payload: null,
      }),
    ).toBeNull();
  });

  it("ignores unrelated messages", () => {
    expect(
      maybeReadVsCodeSelectionContext({
        source: "something-else",
        type: VSCODE_CONTEXT_MESSAGE_TYPE,
        payload: null,
      }),
    ).toBeUndefined();
  });
});

describe("announceVsCodeReady", () => {
  it("notifies the parent window that the app can receive VS Code context", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", {
      parent: { postMessage },
    });

    announceVsCodeReady();

    expect(postMessage).toHaveBeenCalledWith(
      {
        source: VSCODE_CONTEXT_SOURCE,
        type: VSCODE_READY_MESSAGE_TYPE,
      },
      "*",
    );
  });
});
