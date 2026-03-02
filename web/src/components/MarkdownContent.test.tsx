// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownContent } from "./MarkdownContent.js";

describe("MarkdownContent quest links", () => {
  beforeEach(() => {
    window.location.hash = "#/session/s1";
  });

  it("opens quest links as overlay on the current route", () => {
    render(<MarkdownContent text="[q-42](quest:q-42)" />);

    const link = screen.getByRole("link", { name: "q-42" });
    expect(link.getAttribute("href")).toBe("#/session/s1?quest=q-42");
    fireEvent.click(link);
    expect(window.location.hash).toBe("#/session/s1?quest=q-42");
  });

  it("supports bare quest-id hrefs as a short schema", () => {
    render(<MarkdownContent text="[open](q-77)" />);

    const link = screen.getByRole("link", { name: "open" });
    expect(link.getAttribute("href")).toBe("#/session/s1?quest=q-77");
    fireEvent.click(link);
    expect(window.location.hash).toBe("#/session/s1?quest=q-77");
  });

  it("keeps external links as normal web links", () => {
    render(<MarkdownContent text="[docs](https://example.com)" />);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
