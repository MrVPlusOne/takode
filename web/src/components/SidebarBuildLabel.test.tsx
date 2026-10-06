// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SidebarBuildLabel } from "./SidebarBuildLabel.js";

const RealDateTimeFormat = Intl.DateTimeFormat;

describe("SidebarBuildLabel", () => {
  beforeEach(() => {
    window.location.hash = "#/";
    // Simulate a browser in Hawaii, whose zone differs from the Pacific-time server that built the
    // frontend: formatters that omit an explicit timeZone resolve to this browser-local zone.
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new RealDateTimeFormat(locales, { timeZone: "Pacific/Honolulu", ...options });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the build time in the browser's local timezone, not the server's", () => {
    // 23:11 UTC is 4:11 PM PDT on the server but 1:11 PM HST for this browser. A user who read the
    // server's zone as local time once concluded the server had restarted when it had not.
    render(<SidebarBuildLabel buildTime="2026-05-22T23:11:00.000Z" />);

    expect(screen.getByRole("button")).toHaveTextContent("Built May 22, 1:11 PM HST");
  });

  it("opens the changelog from the compact build label", () => {
    const onOpenChangelog = vi.fn();

    render(<SidebarBuildLabel buildTime="2026-05-22T23:11:00.000Z" onOpenChangelog={onOpenChangelog} />);

    const button = screen.getByRole("button", { name: "Built May 22, 1:11 PM HST. Open changelog" });
    expect(button).toHaveAttribute("title", "Open changelog (2026-05-22T23:11:00.000Z)");

    fireEvent.click(button);

    expect(window.location.hash).toBe("#/changelog");
    expect(onOpenChangelog).toHaveBeenCalledTimes(1);
  });
});
