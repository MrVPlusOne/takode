// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { PlaygroundSessionHeaderMenu } from "./PlaygroundSessionHeaderMenu.js";

describe("session header menu Playground", () => {
  it("provides safe right-click actions and keeps the archive warning open until dismissal", () => {
    // The preview exercises the real menu and warning without calling session APIs.
    render(<PlaygroundSessionHeaderMenu />);
    const title = screen.getByRole("button", { name: "#12 Review workspace changes" });
    fireEvent.contextMenu(title);
    fireEvent.click(screen.getByRole("button", { name: "Relaunch" }));
    expect(screen.getByText("Relaunch: preview only")).toBeInTheDocument();
    fireEvent.contextMenu(title);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText("delete the worktree")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Cancelled: preview only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});
