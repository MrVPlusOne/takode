// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const writeClipboardTextMock = vi.hoisted(() => vi.fn(async (_text: string) => undefined));

vi.mock("../utils/copy-utils.js", () => ({
  writeClipboardText: (text: string) => writeClipboardTextMock(text),
}));

import { CodexQuestOwnerChip } from "./CodexQuestOwnerChip.js";

describe("CodexQuestOwnerChip", () => {
  it("copies an opaque Codex task ID without rendering a Takode session link", async () => {
    render(<CodexQuestOwnerChip owner={{ kind: "codex", sessionId: "019fc818-7c2a-7790-ad30-f0d3e7033920" }} />);

    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /copy codex task id/i }));

    await waitFor(() => {
      expect(writeClipboardTextMock).toHaveBeenCalledWith("019fc818-7c2a-7790-ad30-f0d3e7033920");
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });

  it("does not render for a Takode owner", () => {
    const { container } = render(<CodexQuestOwnerChip owner={{ kind: "takode", sessionId: "worker-1" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
