// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolBlock } from "./ToolBlock.js";
import { useStore } from "../store.js";

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

describe("ToolBlock file-read command previews", () => {
  it("renders clear sed reads as a compact file-read preview while preserving expanded command text", () => {
    const command = "sed -n '1,160p' /Users/jiayiwei/Code/HQ/.claude/skills/check/SKILL.md";
    const { container } = render(
      <ToolBlock name="Bash" input={{ command }} toolUseId="sed-read-preview" sessionId="preview-session" />,
    );

    expect(screen.getByText("Read")).toBeTruthy();
    expect(screen.getByText(".../skills/check/")).toBeTruthy();
    expect(screen.getByText("SKILL.md")).toBeTruthy();
    expect(screen.queryByText(/sed -n/)).toBeNull();
    expect(screen.getAllByTitle("/Users/jiayiwei/Code/HQ/.claude/skills/check/SKILL.md").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button"));

    expect(container.textContent).toContain(`$ ${command}`);
  });

  it("leaves ambiguous cat commands on the existing generic terminal preview path", () => {
    render(
      <ToolBlock
        name="Bash"
        input={{ command: "cat web/src/components/ToolBlock.tsx | head" }}
        toolUseId="cat-pipe-preview"
        sessionId="preview-session"
      />,
    );

    expect(screen.queryByText("Read")).toBeNull();
    expect(screen.getByText("cat web/src/components/ToolBlock.tsx | head")).toBeTruthy();
  });
});
