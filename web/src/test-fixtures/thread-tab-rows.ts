/**
 * Test helpers for a leader's quest tabs as its breadcrumb's place picker lists them: every quest
 * tab under no topic is a row in the picker's "Not in a topic" list (tests here file no topics).
 * The picker draws into the crumb place a strip leaves; a bar rendered without a strip on screen
 * (a quest's strip is ChatView's) gets one here.
 */
import { act, fireEvent, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { crumbSlotRef } from "../components/breadcrumb/crumb-slot.js";

const added: Array<() => void> = [];

afterEach(() => {
  for (const remove of added.splice(0)) remove();
});

/** The place picker of the leader bar `container` is or holds (or the page's first), given a crumb place if it has none. */
function placePicker(container?: HTMLElement): HTMLElement | null {
  const rail =
    container?.dataset.testid === "thread-tab-rail"
      ? container
      : within(container ?? document.body).queryAllByTestId("thread-tab-rail")[0];
  const sessionId = rail?.dataset.sessionId;
  if (!sessionId) return null;
  const find = () => document.querySelector<HTMLElement>(`[data-place-crumb-session="${sessionId}"]`);
  if (!find()) {
    const place = document.createElement("span");
    document.body.appendChild(place);
    const ref = crumbSlotRef(sessionId);
    act(() => ref(place));
    added.push(() => {
      act(() => ref(null));
      place.remove();
    });
  }
  return find();
}

function pickerRows(container?: HTMLElement): HTMLElement[] {
  const picker = placePicker(container);
  if (!picker) return [];
  if (!within(picker).queryByTestId("place-crumb-list"))
    fireEvent.click(within(picker).getByTestId("place-crumb-button"));
  const list = within(picker).queryByTestId("place-crumb-list");
  return list ? within(list).queryAllByTestId("thread-tab-list-row") : [];
}

const LISTED_ID = "listed-thread-tabs";

// Copies left by `listedThreadTabs` are not part of any rendered tree, so they go after each test.
afterEach(() => document.querySelector(`[data-testid="${LISTED_ID}"]`)?.remove());

/**
 * The quest tabs the place picker lists. Copies of the rows are kept in the document until
 * `closeAllThreadTabs`: their text and attributes can be queried, but they don't act; use
 * `listedThreadTab` to click one (the picker stays open).
 */
export function listedThreadTabs(container?: HTMLElement): HTMLElement[] {
  const rows = pickerRows(container).map((row) => row.cloneNode(true) as HTMLElement);
  closeAllThreadTabs();
  const holder = document.createElement("div");
  holder.setAttribute("data-testid", LISTED_ID);
  for (const row of rows) holder.appendChild(row);
  document.body.appendChild(holder);
  return rows;
}

/** A tab's row, with the place picker left open so the row can be clicked. */
export function listedThreadTab(threadKey: string, container?: HTMLElement): HTMLElement | undefined {
  const row = pickerRows(container).find((item) => item.dataset.threadKey === threadKey);
  if (!row) closeAllThreadTabs();
  return row;
}

/** Closes any open place picker, and drops the copies `listedThreadTabs` left. */
export function closeAllThreadTabs(): void {
  document.querySelector(`[data-testid="${LISTED_ID}"]`)?.remove();
  for (const list of document.querySelectorAll<HTMLElement>('[data-testid="place-crumb-list"]')) {
    const picker = list.closest<HTMLElement>("[data-place-crumb-session]");
    const button = picker && within(picker).queryByTestId("place-crumb-button");
    if (button) fireEvent.click(button);
  }
}
