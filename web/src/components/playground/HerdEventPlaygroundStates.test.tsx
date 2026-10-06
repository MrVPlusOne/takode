// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaygroundHerdEventStates } from "./HerdEventPlaygroundStates.js";

describe("optional worker report Playground state", () => {
  it("expands the producer-formatted report without approval controls", () => {
    // The fixture uses the same header formatter as the server, preserving parser compatibility.
    render(<PlaygroundHerdEventStates />);
    const report = screen.getByTestId("playground-worker-report");
    const toggle = within(report).getByRole("button", { expanded: false });
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(report).toHaveTextContent("informational; no acknowledgment required");
    expect(report).toHaveTextContent("The compatibility check passed");
    expect(report).toHaveTextContent("quest:q-901:feedback:3");
    expect(within(report).queryByRole("button", { name: /^(approve|reject)\b/i })).toBeNull();
  });
});
