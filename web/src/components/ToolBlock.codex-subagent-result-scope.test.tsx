// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
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

describe("ToolBlock child-owned result scope", () => {
  beforeEach(() => {
    vi.mocked(api.getToolResult).mockReset();
    vi.mocked(api.getToolResult).mockResolvedValue({ content: "ROOT PRIVATE FULL RESULT", is_error: false });
    useStore.setState({
      toolResults: new Map([
        [
          "session-1",
          new Map([
            [
              "shared-tool",
              {
                tool_use_id: "shared-tool",
                content: "ROOT RESULT COLLISION",
                is_error: false,
                total_size: 9_999,
                is_truncated: true,
              },
            ],
          ]),
        ],
      ]),
    });
  });

  afterEach(() => useStore.setState({ toolResults: new Map() }));

  it("keeps a truncated child preview bounded after expansion without offering or fetching the root result", () => {
    render(
      <ToolBlock
        name="Bash"
        input={{ command: "printf child-output" }}
        toolUseId="shared-tool"
        sessionId="session-1"
        resultOverride={{
          tool_use_id: "shared-tool",
          content: "CHILD SAFE PREVIEW TAIL",
          is_error: false,
          total_size: 4_096,
          is_truncated: true,
        }}
        suppressStoredResult
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /printf child-output/i }));

    expect(screen.getByText("bounded preview · truncated")).toBeInTheDocument();
    expect(screen.getByText(/CHILD SAFE PREVIEW TAIL/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show full result" })).toBeNull();
    expect(screen.queryByText(/ROOT RESULT COLLISION|ROOT PRIVATE FULL RESULT/)).toBeNull();
    expect(api.getToolResult).not.toHaveBeenCalled();
  });
});
