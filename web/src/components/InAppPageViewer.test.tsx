// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InAppPageViewerHost } from "./InAppPageViewer.js";

function setHomeScreenApp(value: boolean | undefined) {
  Object.defineProperty(navigator, "standalone", { configurable: true, value });
}

function renderWithLinks() {
  return render(
    <>
      <a href="/file-preview/open?path=report.html&isRelative=1" target="_blank" title="docs/report.html">
        report
      </a>
      <a href="https://github.com/org/repo/pull/1" target="_blank">
        pull request
      </a>
      <a href="/api/settings">same tab</a>
      <InAppPageViewerHost />
    </>,
  );
}

function click(link: HTMLElement): boolean {
  // fireEvent returns false when a handler called preventDefault.
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.click(link);
  });
  return notPrevented;
}

afterEach(() => {
  setHomeScreenApp(undefined);
  document.body.style.overflow = "";
});

describe("InAppPageViewerHost", () => {
  // In the iPhone Home Screen app a Takode-origin page opened in a new tab replaced the
  // whole app with no way back, so such links open in a sheet with a Close button.
  it("opens Takode-origin new-tab links in the in-app viewer in the Home Screen app", () => {
    setHomeScreenApp(true);
    renderWithLinks();

    expect(click(screen.getByText("report"))).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "report.html" });
    expect(dialog.textContent).toContain("docs/report.html");
    const frame = dialog.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(`${location.origin}/file-preview/open?path=report.html&isRelative=1`);
    // Popups and top navigation would take over the app again.
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-popups");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");

    fireEvent.click(screen.getByRole("button", { name: "Close page" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Other origins open in iOS's own browser sheet, which has its own Done button, and
  // same-tab links are not new-tab opens at all.
  it("leaves other-origin and same-tab links alone", () => {
    setHomeScreenApp(true);
    renderWithLinks();

    expect(click(screen.getByText("pull request"))).toBe(true);
    expect(click(screen.getByText("same tab"))).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Browser tabs keep today's behavior: the link opens a real new tab.
  it("does nothing outside the Home Screen app", () => {
    setHomeScreenApp(undefined);
    renderWithLinks();

    expect(click(screen.getByText("report"))).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
