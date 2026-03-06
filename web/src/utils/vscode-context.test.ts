import { describe, expect, it } from "vitest";
import { appendVsCodeContext, isVsCodeSelectionContextPayload } from "./vscode-context.js";

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
