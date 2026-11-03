// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The opened state lives on the server; this stands in for its two routes.
const server = vi.hoisted(() => ({ opened: false, gets: 0, posts: 0 }));
vi.mock("../api/glossary.js", () => ({
  getGlossaryOpened: vi.fn(async () => {
    server.gets++;
    return { opened: server.opened };
  }),
  markGlossaryOpened: vi.fn(async () => {
    server.posts++;
    server.opened = true;
    return { opened: true };
  }),
}));

import { secondaryPageFromHash } from "../utils/routing.js";
import { useGlossaryOpenedStore } from "./glossary-opened.js";
import { GlossaryPage } from "./GlossaryPage.js";
import { SidebarGlossaryLink } from "./SidebarGlossaryLink.js";

const link = () => screen.getByTestId("sidebar-glossary-link");

describe("SidebarGlossaryLink", () => {
  beforeEach(() => {
    server.opened = false;
    server.gets = 0;
    server.posts = 0;
    useGlossaryOpenedStore.setState({ opened: null });
    window.location.hash = "";
  });

  it("stays quiet until the server answers, so it never flashes for users who already opened it", () => {
    // A request that never settles: the state is unknown.
    server.opened = true;
    render(<SidebarGlossaryLink closePanel={false} />);
    expect(link().dataset.highlighted).toBe("false");
  });

  it("is highlighted while the glossary was never opened, and opens the glossary page", async () => {
    render(<SidebarGlossaryLink closePanel={false} />);
    await waitFor(() => expect(link().dataset.highlighted).toBe("true"));

    fireEvent.click(link());
    expect(secondaryPageFromHash(window.location.hash)).toBe("glossary");
  });

  it("goes quiet once the glossary page is shown, recorded on the server", async () => {
    render(<SidebarGlossaryLink closePanel={false} />);
    await waitFor(() => expect(link().dataset.highlighted).toBe("true"));

    // Showing the page, by any route to it, records the first opening.
    render(<GlossaryPage />);
    await waitFor(() => expect(link().dataset.highlighted).toBe("false"));
    expect(server.posts).toBe(1);
    expect(server.opened).toBe(true);
  });

  it("follows another device's opening when the window regains focus", async () => {
    render(<SidebarGlossaryLink closePanel={false} />);
    await waitFor(() => expect(link().dataset.highlighted).toBe("true"));

    server.opened = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(link().dataset.highlighted).toBe("false"));
  });

  it("is quiet for a user who already opened it", async () => {
    server.opened = true;
    render(<SidebarGlossaryLink closePanel={false} />);
    await waitFor(() => expect(server.gets).toBe(1));
    expect(link().dataset.highlighted).toBe("false");
  });
});
