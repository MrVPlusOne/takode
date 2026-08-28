// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../../store.js";
import { PlaygroundFileLinkSection } from "./PlaygroundFileLinkSection.js";

describe("PlaygroundFileLinkSection", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState((state) => ({
      ...state,
      currentSessionId: "takode-playground-session",
      sessions: new Map([
        [
          "takode-playground-session",
          {
            session_id: "takode-playground-session",
            cwd: "/Users/example/Code/takode",
            repo_root: "/Users/example/Code/takode",
            is_worktree: false,
          } as never,
        ],
      ]),
    }));
  });

  afterEach(() => {
    useStore.getState().reset();
  });

  it("renders the live HTML fixture as a native new-tab link for the current Takode session", () => {
    // This dedicated test intentionally renders the real shared Markdown stack. It protects
    // the Playground fixture from becoming detached from the browser-serving link contract.
    render(<PlaygroundFileLinkSection />);

    expect(screen.getByText(/live fixture links resolve through the currently selected session/i)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "interactive HTML demo" });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/file-preview/open");
    expect(url.searchParams.get("path")).toBe("web/src/components/playground/html-file-link-demo/index.html");
    expect(url.searchParams.get("isRelative")).toBe("1");
    expect(url.searchParams.get("sessionId")).toBe("takode-playground-session");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
