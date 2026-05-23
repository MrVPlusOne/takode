// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SidebarBuildLabel } from "./SidebarBuildLabel.js";

describe("SidebarBuildLabel", () => {
  beforeEach(() => {
    window.location.hash = "#/";
  });

  it("opens the changelog from the compact build label", () => {
    const onOpenChangelog = vi.fn();

    render(<SidebarBuildLabel buildTime="2026-05-22T23:11:00.000Z" onOpenChangelog={onOpenChangelog} />);

    const button = screen.getByRole("button", { name: "Built May 22, 4:11 PM PT. Open changelog" });
    expect(button).toHaveTextContent("Built May 22, 4:11 PM PT");
    expect(button).toHaveAttribute("title", "Open changelog (2026-05-22T23:11:00.000Z)");

    fireEvent.click(button);

    expect(window.location.hash).toBe("#/changelog");
    expect(onOpenChangelog).toHaveBeenCalledTimes(1);
  });
});
