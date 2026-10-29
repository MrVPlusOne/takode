import { create } from "zustand";
import { setTopicPanelOpen, setTopicSheetOpen } from "./topic-panel.js";
import { readDisplayedLeaderThreadKey } from "./thread-viewport.js";

/**
 * What a leader's side column holds besides the topic page it follows: things the user put there
 * to keep beside the main conversation (Logseq's right sidebar). Newest first; one of them, or the
 * topic page ("home"), is open. Remembered per leader in this browser: local UI state, like the
 * column's width.
 */
export type SideItem =
  | { id: string; kind: "topic"; topicId: string }
  /** A conversation of the leader: a quest, a topic's conversation, or a side chat (a thread). */
  | { id: string; kind: "conversation"; threadKey: string }
  /** A side chat being started: its first message starts the thread, from `startedFrom`. */
  | { id: string; kind: "new-chat"; startedFrom: string | null };

export type SideItemInput = SideItem extends infer Item ? (Item extends SideItem ? Omit<Item, "id"> : never) : never;

/** The topic page the column follows (the tab's topic, or the leader's topic list). */
export const HOME_ITEM = "home";

interface LeaderColumn {
  items: SideItem[];
  /** The item shown open: an item's ID or HOME_ITEM. */
  open: string;
}

interface SideColumnState {
  columns: Record<string, LeaderColumn>;
}

const STORAGE_KEY = "cc-side-columns";
const MAX_ITEMS = 12;
const EMPTY: LeaderColumn = { items: [], open: HOME_ITEM };

function stored(): Record<string, LeaderColumn> {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, LeaderColumn>;
  } catch (error) {
    console.warn("[side-column] Ignoring unreadable side column state:", error);
    return {};
  }
}

export const useSideColumnStore = create<SideColumnState>(() => ({
  columns: stored(),
}));

function update(leaderId: string, change: (column: LeaderColumn) => LeaderColumn): void {
  const columns = { ...useSideColumnStore.getState().columns };
  columns[leaderId] = change(columns[leaderId] ?? EMPTY);
  useSideColumnStore.setState({ columns });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
}

function sameTarget(a: SideItemInput, b: SideItemInput): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "topic":
      return a.topicId === (b as typeof a).topicId;
    case "conversation":
      return a.threadKey.toLowerCase() === (b as typeof a).threadKey.toLowerCase();
    case "new-chat":
      return true;
  }
}

/**
 * Puts something in a leader's side column, or brings it back to the top if it is there already,
 * opens it and shows the column (on phones, its sheet).
 */
export function openInSide(leaderId: string, input: SideItemInput): string {
  let id = "";
  update(leaderId, (column) => {
    const existing = column.items.find((item) => sameTarget(item, input));
    const item = existing ? ({ ...existing, ...input } as SideItem) : ({ ...input, id: newId() } as SideItem);
    id = item.id;
    return {
      items: [item, ...column.items.filter((other) => other.id !== item.id)].slice(0, MAX_ITEMS),
      open: item.id,
    };
  });
  setTopicPanelOpen(leaderId, true);
  setTopicSheetOpen(leaderId, true);
  return id;
}

/** Opens one of the column's items (or HOME_ITEM), folding the one open before. */
export function openSideItem(leaderId: string, id: string): void {
  update(leaderId, (column) => ({ ...column, open: id }));
}

/** Takes an item out of the column; the one after it opens if it was open. */
export function closeSideItem(leaderId: string, id: string): void {
  update(leaderId, (column) => {
    const index = column.items.findIndex((item) => item.id === id);
    const items = column.items.filter((item) => item.id !== id);
    if (column.open !== id) return { ...column, items };
    const next = items[Math.min(index, items.length - 1)];
    return { items, open: next?.id ?? HOME_ITEM };
  });
}

/** Turns an item into another in place, such as a new side chat into its thread once it started. */
export function replaceSideItem(leaderId: string, id: string, input: SideItemInput): void {
  update(leaderId, (column) => ({
    ...column,
    items: column.items.map((item) => (item.id === id ? ({ ...input, id } as SideItem) : item)),
  }));
}

export function useSideColumn(leaderId: string): LeaderColumn {
  return useSideColumnStore((state) => state.columns[leaderId] ?? EMPTY);
}

function newId(): string {
  return `side-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * What a side chat started now is about: the quest or topic the main view shows (its leader is told);
 * none from Main or All.
 */
export function sideChatOrigin(leaderId: string): string | null {
  const key = readDisplayedLeaderThreadKey(leaderId)?.toLowerCase() ?? "";
  return /^q-\d+$/.test(key) || key.startsWith("topic:") ? key : null;
}

/** The modifier keys of a click, enough to tell whether it opens something in the side column. */
export interface OpenInSideEvent {
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * Whether a click asks to open its target in the side column rather than the main view: Shift-click
 * on desktop, like Logseq (to be configurable in Settings).
 */
export function isOpenInSideClick(event: OpenInSideEvent | undefined): boolean {
  return !!event?.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
}

/**
 * Opens a leader's quest or thread in its side column, when that leader's conversation is on screen
 * (the side column belongs to it). Returns false when it isn't, so the click does what it would.
 */
export function openConversationInSide(leaderId: string, threadKey: string): boolean {
  if (readDisplayedLeaderThreadKey(leaderId) === null) return false;
  openInSide(leaderId, { kind: "conversation", threadKey: threadKey.toLowerCase() });
  return true;
}
