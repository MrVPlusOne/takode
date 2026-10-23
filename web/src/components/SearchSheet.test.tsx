// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchMeta, SearchSheet } from "./SearchSheet.js";

describe("SearchSheet", () => {
  it("closes on a click on the backdrop or on Done, but not when a press inside the sheet ends outside it", () => {
    // Pressing inside and letting go outside (selecting text) sends the click to the backdrop;
    // that must not dismiss the sheet.
    const onClose = vi.fn();
    render(
      <SearchSheet label="Find" header={<span>Find a tab</span>} onClose={onClose} backdropTestId="backdrop">
        <p>Body</p>
      </SearchSheet>,
    );
    const backdrop = screen.getByTestId("backdrop");

    fireEvent.pointerDown(screen.getByText("Body"));
    fireEvent.pointerUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders the fixed sheet in the page body, outside the app's zoomed root", () => {
    // Both searches portal to the body so they render at the same size; the global search
    // used to sit inside the app's scaled root while Find did not.
    const { container } = render(
      <SearchSheet label="Universal Search" header={null} onClose={() => {}}>
        <p>Body</p>
      </SearchSheet>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(document.body).toContainElement(screen.getByRole("dialog", { name: "Universal Search" }));
  });

  it("renders the inline presentation in place without a backdrop", () => {
    const { container } = render(
      <SearchSheet label="Universal Search" header={null} onClose={() => {}} presentation="inline" backdropTestId="b">
        <p>Body</p>
      </SearchSheet>,
    );
    expect(container).toContainElement(screen.getByRole("dialog", { name: "Universal Search" }));
    expect(screen.queryByTestId("b")).toBeNull();
  });
});

describe("SearchMeta", () => {
  it("joins the details it has with separators and skips missing ones", () => {
    const { container } = render(<SearchMeta items={["Main", null, "", false, "Done", "3m ago"]} />);
    expect(container.textContent).toBe("Main · Done · 3m ago");
  });
});
