// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("./TodoListPanel.js", () => ({ TodoListPanel: () => <div data-testid="todo-outline" /> }));
vi.mock("./ActiveTimersPage.js", () => ({ ActiveTimersPage: () => <div data-testid="active-timers" /> }));

import { TodosAndTimersPage } from "./TodosAndTimersPage.js";

describe("TodosAndTimersPage", () => {
  it("keeps personal to-dos primary and Timers lower and collapsed by default", () => {
    render(<TodosAndTimersPage />);
    expect(screen.getByTestId("todo-outline")).toBeInTheDocument();
    const section = screen.getByTestId("timers-collapsible-section");
    expect(section).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("▸ Timers"));
    expect(section).toHaveAttribute("open");
    expect(screen.getByTestId("active-timers")).toBeInTheDocument();
  });
});
