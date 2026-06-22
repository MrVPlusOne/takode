// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { ToolBlock } from "./ToolBlock.js";

vi.mock("../api.js", () => ({
  api: {
    getSettings: vi.fn(),
    getToolResult: vi.fn(),
    getFsImageUrl: vi.fn((path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`),
    openVsCodeRemoteFile: vi.fn(),
  },
}));

describe("ToolBlock WebSearch details", () => {
  beforeEach(() => {
    vi.mocked(api.getSettings).mockResolvedValue({ editorConfig: { editor: "vscode-local" } } as Awaited<
      ReturnType<typeof api.getSettings>
    >);
    useStore.setState({ toolResults: new Map() });
  });

  afterEach(() => {
    vi.mocked(api.getSettings).mockReset();
    vi.mocked(api.getToolResult).mockReset();
    vi.mocked(api.openVsCodeRemoteFile).mockReset();
    useStore.setState({ toolResults: new Map() });
  });

  it("renders all useful queries from a multi-query Codex Web Search action", () => {
    // Codex may collapse several requested searches into one tool id with
    // action.queries. The expanded detail should show the whole query list.
    render(
      <ToolBlock
        name="WebSearch"
        input={{
          query: "OpenAI Codex CLI documentation",
          action: {
            type: "search",
            query: "OpenAI Codex CLI documentation",
            queries: ["OpenAI Codex CLI documentation", "MDN MediaRecorder start timeslice"],
          },
        }}
        toolUseId="ws-multi-query"
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getAllByText("OpenAI Codex CLI documentation").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("MDN MediaRecorder start timeslice")).toBeTruthy();
  });
});
