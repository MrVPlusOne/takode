/**
 * Test helpers for leader thread tabs shown as status groups: every open quest tab is listed in
 * its group's list, which a long-press or right-click on the group opens.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";

function groupChips(container?: HTMLElement): HTMLElement[] {
  const scope = container ? within(container) : screen;
  return scope.queryAllByTestId("thread-tab-group-chip");
}

/** Opens one group's list and returns its rows (they stay in the document until it closes). */
function openGroupRows(chip: HTMLElement): HTMLElement[] {
  const backdrop = screen.queryByTestId("thread-tab-group-backdrop");
  if (backdrop) fireEvent.click(backdrop);
  fireEvent.contextMenu(chip, { clientX: 1, clientY: 1 });
  return within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row");
}

const LISTED_ID = "listed-thread-tabs";

// Copies left by `listedThreadTabs` are not part of any rendered tree, so they go after each test.
afterEach(() => document.querySelector(`[data-testid="${LISTED_ID}"]`)?.remove());

/**
 * The open quest tabs, group by group in the bar's order and each group's own order (Main
 * excluded). Only one group's list can be open, so copies of every group's rows are kept in the
 * document until `closeAllThreadTabs`: their text and attributes can be queried, but they don't
 * act; use `listedThreadTab` to click one (its group's list stays open).
 */
export function listedThreadTabs(container?: HTMLElement): HTMLElement[] {
  const rows = groupChips(container).flatMap((chip) =>
    openGroupRows(chip).map((row) => row.cloneNode(true) as HTMLElement),
  );
  closeAllThreadTabs();
  const holder = document.createElement("div");
  holder.setAttribute("data-testid", LISTED_ID);
  for (const row of rows) holder.appendChild(row);
  document.body.appendChild(holder);
  return rows.filter((row) => row.dataset.threadKey !== "main");
}

/** Every open quest tab's key as the bar's status groups list them: group by group, in each group's order. */
export function groupedThreadTabKeys(): string[] {
  const keys = listedThreadTabs().map((row) => row.dataset.threadKey ?? "");
  closeAllThreadTabs();
  return keys;
}

/** The thread keys a status group lists, in its order; opens and closes the group's list. */
export function groupThreadTabKeys(group: string): string[] {
  const chip = groupChips().find((item) => item.dataset.group === group);
  if (!chip) return [];
  const keys = openGroupRows(chip).map((row) => row.dataset.threadKey ?? "");
  closeAllThreadTabs();
  return keys;
}

/** A tab's row, with its group's list left open so the row can be clicked. */
export function listedThreadTab(threadKey: string, container?: HTMLElement): HTMLElement | undefined {
  for (const chip of groupChips(container)) {
    const row = openGroupRows(chip).find((item) => item.dataset.threadKey === threadKey);
    if (row) return row;
  }
  closeAllThreadTabs();
  return undefined;
}

/** Closes a group's list if one is open, and drops the copies `listedThreadTabs` left. */
export function closeAllThreadTabs(): void {
  document.querySelector(`[data-testid="${LISTED_ID}"]`)?.remove();
  const backdrop = screen.queryByTestId("thread-tab-group-backdrop");
  if (backdrop) fireEvent.click(backdrop);
}
