// @vitest-environment jsdom
import { act, render } from "@testing-library/react";

import { useStore } from "../store.js";
import { SidebarTitleRow } from "./SidebarTitleRow.js";

vi.mock("./NavigationButtons.js", () => ({ NavigationButtons: () => null }));

// The sidebar's app logo follows Takode's theme: the night painting in the dark theme, and it
// switches live when the theme changes.
it("shows the day logo in the light theme and the night logo in the dark theme", () => {
  act(() => useStore.setState({ darkMode: false }));
  const { container } = render(<SidebarTitleRow />);
  const logo = () => container.querySelector("img")!.getAttribute("src");
  expect(logo()).toBe("/app-logo.png");

  act(() => useStore.setState({ darkMode: true }));
  expect(logo()).toBe("/app-logo-night.png");
});
