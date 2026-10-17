/**
 * Test helpers for leader thread tabs shown as status groups: every open tab is listed in
 * its group's list and in Find's Tabs mode, which the search item opens.
 */
import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the all-tabs sheet of the rail inside `container` (or the only rail). */
export function openAllThreadTabs(container?: HTMLElement): HTMLElement {
  const existing = screen.queryByTestId("thread-tab-switcher");
  if (existing) return existing;
  const scope = container ? within(container) : screen;
  fireEvent.click(scope.getByTestId("thread-tab-group-search"));
  const sheet = screen.getByTestId("thread-tab-switcher");
  const tabsMode = within(sheet)
    .queryAllByTestId("thread-find-mode")
    .find((button) => button.dataset.mode === "tabs");
  if (tabsMode) fireEvent.click(tabsMode);
  return sheet;
}

/** The open quest tabs Find lists (Main and closed tabs excluded), most recently active first. */
export function listedThreadTabs(container?: HTMLElement): HTMLElement[] {
  const sheet = openAllThreadTabs(container);
  return within(sheet)
    .getAllByTestId("thread-tab-list-row")
    .filter((row) => row.dataset.threadKey !== "main" && row.dataset.closed !== "true");
}

/** Every open quest tab's key as the bar's status groups list them: group by group, in each group's order. */
export function groupedThreadTabKeys(): string[] {
  closeAllThreadTabs();
  return screen
    .queryAllByTestId("thread-tab-group-chip")
    .flatMap((chip) => groupThreadTabKeys(chip.dataset.group ?? ""));
}

/** The thread keys a status group lists, in its order; opens and closes the group's list. */
export function groupThreadTabKeys(group: string): string[] {
  closeAllThreadTabs();
  const chip = screen.getAllByTestId("thread-tab-group-chip").find((item) => item.dataset.group === group);
  if (!chip) return [];
  fireEvent.contextMenu(chip, { clientX: 1, clientY: 1 });
  const keys = within(screen.getByTestId("thread-tab-group-list"))
    .getAllByTestId("thread-tab-list-row")
    .map((row) => row.dataset.threadKey ?? "");
  fireEvent.click(screen.getByTestId("thread-tab-group-backdrop"));
  return keys;
}

export function listedThreadTab(threadKey: string, container?: HTMLElement): HTMLElement | undefined {
  return listedThreadTabs(container).find((row) => row.dataset.threadKey === threadKey);
}

/** Closes the all-tabs sheet if it is open. */
export function closeAllThreadTabs(): void {
  const backdrop = screen.queryByTestId("thread-tab-switcher-backdrop");
  if (backdrop) fireEvent.click(backdrop);
}
