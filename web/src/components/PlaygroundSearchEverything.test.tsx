// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Playground } from "./Playground.js";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

describe("Playground Search Everything states", () => {
  it("documents grouped result and state variants", () => {
    render(<Playground />);

    expect(screen.getAllByText("Search Everything").length).toBeGreaterThan(0);
    expect(screen.getByText("Mixed grouped results")).toBeTruthy();
    expect(document.body).toHaveTextContent(/#12\s*Auth\s*workflow\s*worker/i);
    expect(document.body).toHaveTextContent(/q-42\s*Implement\s*search-?\s*everything\s*feature/i);
    expect(screen.getByText("+4 more matches")).toBeTruthy();
    expect(screen.getByText("+2 more matches")).toBeTruthy();
    expect(screen.getByText("No results")).toBeTruthy();
    expect(screen.getByText("Search failed")).toBeTruthy();
    expect(screen.getAllByText("Searching").length).toBeGreaterThan(0);
  });
});
