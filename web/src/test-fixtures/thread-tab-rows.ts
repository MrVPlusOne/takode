/**
 * Test helpers for leader thread tabs shown as status groups: every open tab is listed,
 * under its group, in the all-tabs sheet that the search item opens.
 */
import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the all-tabs sheet of the rail inside `container` (or the only rail). */
export function openAllThreadTabs(container?: HTMLElement): HTMLElement {
  const existing = screen.queryByTestId("thread-tab-switcher");
  if (existing) return existing;
  const scope = container ? within(container) : screen;
  fireEvent.click(scope.getByTestId("thread-tab-group-search"));
  return screen.getByTestId("thread-tab-switcher");
}

/** The listed quest tabs (Main excluded), in the order the sheet shows them. */
export function listedThreadTabs(container?: HTMLElement): HTMLElement[] {
  const sheet = openAllThreadTabs(container);
  return within(sheet)
    .getAllByTestId("thread-tab-list-row")
    .filter((row) => row.dataset.threadKey !== "main");
}

export function listedThreadTab(threadKey: string, container?: HTMLElement): HTMLElement | undefined {
  return listedThreadTabs(container).find((row) => row.dataset.threadKey === threadKey);
}

/** Closes the all-tabs sheet if it is open. */
export function closeAllThreadTabs(): void {
  const backdrop = screen.queryByTestId("thread-tab-switcher-backdrop");
  if (backdrop) fireEvent.click(backdrop);
}
