// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetChangelog = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    getChangelog: (...args: unknown[]) => mockGetChangelog(...args),
  },
}));

vi.mock("./MarkdownContent.js", () => ({
  MarkdownContent: ({ text }: { text: string }) => <article data-testid="markdown-content">{text}</article>,
}));

import { ChangelogPage } from "./ChangelogPage.js";

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#/changelog";
});

describe("ChangelogPage", () => {
  it("renders changelog markdown loaded from the server", async () => {
    mockGetChangelog.mockResolvedValue({
      markdown: "# Takode Changelog\n\n## 2026-05-20\n\n- Added Settings changelog viewer",
      sourcePath: "CHANGELOG.md",
    });

    render(<ChangelogPage />);

    expect(await screen.findByTestId("markdown-content")).toHaveTextContent("Takode Changelog");
    expect(screen.getByText("CHANGELOG.md")).toBeInTheDocument();
  });

  it("shows a compact error state when the changelog cannot be read", async () => {
    mockGetChangelog.mockRejectedValue(new Error("Changelog file not found"));

    render(<ChangelogPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Changelog unavailable");
    expect(alert).toHaveTextContent("Changelog file not found");
  });

  it("returns to Settings from the header action", async () => {
    mockGetChangelog.mockResolvedValue({ markdown: "# Takode Changelog", sourcePath: "CHANGELOG.md" });

    render(<ChangelogPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Back to Settings" }));

    expect(window.location.hash).toBe("#/settings");
  });
});
