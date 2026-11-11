// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { ActivityDot, Spinner } from "./LoadingIndicators.js";

describe("Spinner", () => {
  // Every spinner in the app turns through animate-spin, which index.css steps 12 times a
  // second, so a visible spinner never makes Chrome draw at the full display rate.
  it("turns through the shared stepped spin and takes its size and color from the caller", () => {
    const { container } = render(<Spinner className="h-5 w-5 text-cc-primary" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveClass("animate-spin", "h-5", "w-5", "text-cc-primary");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("ActivityDot", () => {
  // Only an active dot gets the class whose glow breathes three times and then holds;
  // a held dot (stuck or paused turn) stays a plain dot.
  it("breathes only while active", () => {
    const { container, rerender } = render(<ActivityDot className="text-cc-primary" active />);
    const dot = container.querySelector(".cc-activity-dot")!;
    expect(dot).toHaveClass("is-active", "text-cc-primary");

    rerender(<ActivityDot className="text-cc-attention" />);
    expect(container.querySelector(".cc-activity-dot")).not.toHaveClass("is-active");
  });
});
