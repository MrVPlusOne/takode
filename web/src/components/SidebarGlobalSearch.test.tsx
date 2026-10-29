// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { useStore } from "../store.js";
import { SidebarGlobalSearch } from "./SidebarGlobalSearch.js";

beforeEach(() => {
  useStore.setState({
    sidebarOpen: true,
    shortcutSettings: {
      enabled: true,
      preset: "standard",
      typeToCompose: true,
      openInSideModifier: "shift",
      overrides: {},
    },
  });
});

describe("SidebarGlobalSearch", () => {
  // The search field is the panel header's only control: the Quests chip duplicated
  // the bottom bar's Questmaster button and was removed, so the field spans the row.
  it("renders a single global search field with the shortcut in its tooltip", () => {
    render(<SidebarGlobalSearch closePanelOnOpen={false} />);
    const search = screen.getByRole("button", { name: "Universal Search" });
    expect(search).toHaveTextContent("Search everything…");
    expect(search.title).toMatch(/^Search everything \(.+F\)$/);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Quests/ })).not.toBeInTheDocument();
  });

  // With shortcuts turned off there is no binding to advertise in the tooltip.
  it("omits the shortcut hint when shortcuts are disabled", () => {
    useStore.setState({
      shortcutSettings: {
        enabled: false,
        preset: "standard",
        typeToCompose: true,
        openInSideModifier: "shift",
        overrides: {},
      },
    });
    render(<SidebarGlobalSearch closePanelOnOpen={false} />);
    const search = screen.getByRole("button", { name: "Universal Search" });
    expect(search.title).toBe("Search everything");
  });

  it("keeps the inline desktop panel open when it opens the search", () => {
    const onOpenUniversalSearch = vi.fn();
    render(<SidebarGlobalSearch closePanelOnOpen={false} onOpenUniversalSearch={onOpenUniversalSearch} />);

    fireEvent.click(screen.getByRole("button", { name: "Universal Search" }));
    expect(onOpenUniversalSearch).toHaveBeenCalledTimes(1);
    expect(useStore.getState().sidebarOpen).toBe(true);
  });

  it("closes the phone panel before opening the search", () => {
    const onOpenUniversalSearch = vi.fn();
    render(<SidebarGlobalSearch closePanelOnOpen onOpenUniversalSearch={onOpenUniversalSearch} />);

    fireEvent.click(screen.getByRole("button", { name: "Universal Search" }));
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(onOpenUniversalSearch).toHaveBeenCalledTimes(1);
  });
});
