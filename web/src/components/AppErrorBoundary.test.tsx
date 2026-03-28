// @vitest-environment jsdom
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary.js";

function Crasher(): ReactElement {
  throw new Error("render failed");
}

describe("AppErrorBoundary", () => {
  it("shows fallback UI on render error", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Crasher />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("A runtime error occurred")).toBeTruthy();
    consoleErrorSpy.mockRestore();
  });

  it("shows the error message in technical details", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <AppErrorBoundary>
        <Crasher />
      </AppErrorBoundary>,
    );

    // Technical details should be in a collapsed <details> element
    const details = screen.getByText("Technical details");
    expect(details).toBeTruthy();

    // Expand the details
    fireEvent.click(details);

    // The original error message should be visible inside the <pre> tag
    const errorPre = container.querySelector("pre.text-\\[11px\\]");
    expect(errorPre?.textContent).toContain("render failed");
    consoleErrorSpy.mockRestore();
  });

  it("offers both Reload and Retry buttons", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Crasher />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    consoleErrorSpy.mockRestore();
  });

  it("shows a friendly message for React error #185 (max update depth)", () => {
    // Simulate the minified React error #185 message
    function MaxDepthCrasher(): ReactElement {
      throw new Error("Minified React error #185; visit https://react.dev/errors/185");
    }

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <MaxDepthCrasher />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByText("A UI component entered an infinite update loop (Maximum update depth exceeded)."),
    ).toBeTruthy();
    consoleErrorSpy.mockRestore();
  });
});
