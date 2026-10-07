// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../../store.js";
import { PlaygroundCompactToolActivityStates } from "./CompactToolActivityPlaygroundStates.js";

vi.mock("../../api.js", () => ({
  api: {
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
    getToolResult: vi.fn(),
  },
}));

beforeEach(() => {
  useStore.getState().reset();
});

function lineTexts(root: HTMLElement): string[] {
  return within(root)
    .getAllByTestId("compact-tool-activity-line")
    .map((line) => line.textContent ?? "");
}

describe("Compact tool activity Playground states", () => {
  it("documents collapsed, expanded and live activity groups from the real components", () => {
    // These fixtures are the visual reference for the activity-group design, so
    // they must exercise the real group component with seeded result state.
    render(<PlaygroundCompactToolActivityStates />);

    // Collapsed history: agent text follows the group, so it shows only its
    // heading, which still counts the seeded failing test run.
    const conversation = screen.getByTestId("playground-activity-conversation");
    const [group, single] = within(conversation).getAllByTestId("compact-tool-activity");
    expect(within(group).queryAllByTestId("compact-tool-activity-line")).toHaveLength(0);
    expect(within(group).queryByTestId("compact-tool-activity-earlier")).toBeNull();
    expect(within(group).getByText("1 failed")).toBeTruthy();
    // A lone activity between two pieces of text is just its line, without a heading.
    expect(lineTexts(single)).toEqual(["BashRecord the decision, resume Work, and instruct the worker"]);

    // Expanded: every line is listed, starting with the thought.
    const expanded = screen.getByTestId("playground-activity-expanded");
    expect(lineTexts(expanded)).toHaveLength(10);
    expect(lineTexts(expanded)[0]).toBe("ThoughtCheck where the preview falls back");

    // Live: the newest activity is running, and the next one rolls the window.
    const live = screen.getByTestId("playground-activity-live");
    expect(within(live).getByTestId("compact-tool-activity-earlier")).toHaveTextContent("+3 earlier");
    fireEvent.click(within(live).getByRole("button", { name: "Next activity arrives" }));
    expect(within(live).getByTestId("compact-tool-activity-earlier")).toHaveTextContent("+4 earlier");
    expect(lineTexts(live).at(-1)).toContain("Run focused ToolBlock tests");

    // Line previews: each line names what it touched instead of repeating its label.
    expect(lineTexts(screen.getByTestId("playground-activity-preview-lines"))).toEqual([
      "Skillquest",
      "Edit.../src/components/ThreadReplyChip.tsx",
      "Edit.../src/components/CompactToolActivity.tsx+1 more",
      "MCPslack:slack_get_thread",
    ]);
  });
});
