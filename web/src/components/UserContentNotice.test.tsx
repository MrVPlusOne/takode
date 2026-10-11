// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserContentNotice } from "./UserContentNotice.js";
import { takeUserContentFocusRequest } from "../user-content.js";

/** The notice asks the server whether to show; dismissing tells the server, so it stays gone in every browser. */
function serve(show: boolean) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ show }));
    }),
  );
  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("UserContentNotice", () => {
  it("stays hidden when the server says there is nothing to set up", async () => {
    const requests = serve(false);
    const { container } = render(<UserContentNotice />);
    await waitFor(() => expect(requests).toEqual(["GET /api/user-content/notice"]));
    expect(container.textContent).toBe("");
  });

  it("opens Settings from Set up, and Dismiss hides it and tells the server", async () => {
    const requests = serve(true);
    render(<UserContentNotice />);

    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    expect(window.location.hash).toBe("#/settings");
    // The Settings section picks this up and scrolls itself into view once rendered.
    expect(takeUserContentFocusRequest()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
    await waitFor(() => expect(requests).toContain("POST /api/user-content/notice/dismiss"));
  });
});
