// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { getPreview, ToolBlock, ToolBlockEmbeddedContext } from "./ToolBlock.js";

vi.mock("../api.js", () => ({
  api: {
    getSettings: vi.fn(),
    getToolResult: vi.fn(),
    getFsImageUrl: vi.fn((path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`),
    openVsCodeRemoteFile: vi.fn(),
  },
}));

beforeEach(() => {
  useStore.setState({ toolResults: new Map(), toolProgress: new Map(), toolStartTimestamps: new Map() });
});

describe("ToolBlock Bash previews", () => {
  it("shows a short description once: in the header, not again in the details", () => {
    // The header already uses a short Bash description as its preview, so the
    // opened details should go straight to the command.
    render(
      <ToolBlock
        name="Bash"
        input={{ command: "rg flush", description: "Find flush origin" }}
        toolUseId="bash-description-once"
        sessionId="preview-session"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Find flush origin/ }));
    expect(screen.getAllByText("Find flush origin")).toHaveLength(1);
    expect(screen.getByText("rg flush")).toBeTruthy();
  });

  it("keeps a long description in the details because the header shows the command", () => {
    const description = "Find where the replay-gated flush starts and which tests assert it today";
    render(
      <ToolBlock
        name="Bash"
        input={{ command: "rg flush", description }}
        toolUseId="bash-long-description"
        sessionId="preview-session"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /rg flush/ }));
    expect(screen.getByText(description)).toBeTruthy();
  });

  it("renders only the details when an enclosing row is its header", () => {
    // A compact row standing for one tool already shows the description, so
    // the embedded block has no header of its own and starts open.
    render(
      <ToolBlockEmbeddedContext.Provider value>
        <ToolBlock
          name="Bash"
          input={{ command: "rg flush", description: "Find flush origin" }}
          toolUseId="bash-embedded"
          sessionId="preview-session"
        />
      </ToolBlockEmbeddedContext.Provider>,
    );

    expect(screen.queryByRole("button", { name: /Find flush origin/ })).toBeNull();
    expect(screen.queryByText("Find flush origin")).toBeNull();
    expect(screen.getByText("rg flush")).toBeTruthy();
  });

  it("renders embedded command newlines as visible markers in the collapsed header", () => {
    // A single Bash tool call can contain several shell lines. The collapsed
    // chip must signal those line breaks instead of letting inline whitespace
    // handling make the command look like one space-separated line.
    render(
      <ToolBlock
        name="Bash"
        input={{ command: "quest status q-1696\ntakode board show" }}
        toolUseId="bash-multiline-preview"
        sessionId="preview-session"
      />,
    );

    expect(screen.getByText("quest status q-1696 \\n takode board show")).toBeTruthy();
  });

  it("marks newlines before applying the compact Bash preview length limit", () => {
    // The newline marker should participate in the existing compact preview
    // budget so collapsed rows stay a single bounded header.
    const preview = getPreview("Bash", {
      command: `${"a".repeat(55)}\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
    });

    expect(preview).toBe(`${"a".repeat(55)} \\n b...`);
    expect(preview.length).toBe(63);
  });

  it("keeps newline markers visible when the line break reaches the cutoff boundary", () => {
    // Regression for q-1696 review feedback: the marker must remain atomic
    // when it would otherwise be sliced into a space, backslash, or nothing.
    for (const charsBeforeNewline of [58, 59, 60]) {
      const preview = getPreview("Bash", {
        command: `${"a".repeat(charsBeforeNewline)}\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
      });

      expect(preview).toBe(`${"a".repeat(56)} \\n ...`);
      expect(preview.length).toBe(63);
    }
  });
});
