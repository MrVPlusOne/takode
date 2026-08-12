// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { SessionRoleLabel } from "./SessionRoleLabel.js";

describe("SessionRoleLabel", () => {
  it("keeps full leader labels at standard mobile widths with a sub-320px initial fallback", () => {
    // The full role is the normal presentation; the initial exists only for the
    // exceptional viewport below the narrowest supported 320px mobile check.
    render(<SessionRoleLabel role="Leader" />);

    expect(screen.getByTestId("session-role-icon-leader")).toBeInTheDocument();
    expect(screen.getByText("Leader")).toHaveClass("max-[319px]:hidden");
    expect(screen.getByText("L")).toHaveClass("hidden", "max-[319px]:inline");
    expect(screen.getByText("L")).toHaveAttribute("aria-hidden", "true");
  });

  it("uses the worker role icon without inventing a reviewer icon", () => {
    const view = render(<SessionRoleLabel role="Worker" />);
    expect(screen.getByTestId("session-role-icon-worker")).toBeInTheDocument();

    view.rerender(<SessionRoleLabel role="Reviewer" />);
    expect(screen.queryByTestId(/session-role-icon-/)).not.toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toHaveClass("hidden", "sm:inline");
    expect(screen.queryByText("R")).not.toBeInTheDocument();
  });
});
