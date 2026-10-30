import { create } from "zustand";
import { setTopicPanelOpen, setTopicSheetOpen } from "./topic-panel.js";
import { readDisplayedLeaderThreadKey } from "./thread-viewport.js";
import { useStore } from "../store.js";
import { platformIsMac } from "../shortcuts.js";
import type { OpenInSideModifier } from "../../shared/shortcut-settings.js";
import { openLibraryArtifact } from "./library-nav.js";
import { isNewWindowClick, openArtifactWindow } from "./artifact-window.js";

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
  | { id: string; kind: "new-chat"; startedFrom: string | null }
  /** A Library artifact (a report, post, figure...), at a version when one was linked. */
  | { id: string; kind: "artifact"; artifactId: string; version?: number; title?: string };

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
    case "artifact":
      return a.artifactId === (b as typeof a).artifactId;
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
 * Whether a click asks to open its target in the side column rather than the main view: a click
 * with the key chosen in Settings > Keyboard held, and no other (Shift-click by default, like Logseq).
 */
export function isOpenInSideClick(
  event: OpenInSideEvent | undefined,
  modifier: OpenInSideModifier = useStore.getState().shortcutSettings?.openInSideModifier ?? "shift",
): boolean {
  if (!event) return false;
  const held = { shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey };
  return held[modifier] && Object.entries(held).every(([key, down]) => key === modifier || !down);
}

/** How the click that opens something in the side column is named, for tooltips: "Shift-click". */
export function openInSideClickLabel(
  modifier: OpenInSideModifier = useStore.getState().shortcutSettings?.openInSideModifier ?? "shift",
): string {
  const mac = platformIsMac(currentPlatform());
  const key = { shift: "Shift", alt: mac ? "Option" : "Alt" }[modifier];
  return `${key}-click`;
}

function currentPlatform(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.platform;
}

/**
 * Opens an artifact where a click asks: in a window of its own on Cmd/Ctrl-click, in the side
 * column of the leader on screen on an open-in-side click, else in the Library (also when no
 * leader's conversation is on screen).
 */
export function openArtifact(target: { id: string; version?: number; title?: string }, event?: OpenInSideEvent): void {
  if (isNewWindowClick(event)) {
    openArtifactWindow(target);
    return;
  }
  if (isOpenInSideClick(event) && openArtifactInSide(target)) return;
  openLibraryArtifact(target.id, target.version);
}

/**
 * Opens an artifact in the side column of the leader whose conversation is on screen. Returns false
 * when no leader's is, so the caller opens it elsewhere.
 */
export function openArtifactInSide(target: { id: string; version?: number; title?: string }): boolean {
  const leaderId = useStore.getState().currentSessionId;
  if (!leaderId || readDisplayedLeaderThreadKey(leaderId) === null) return false;
  openInSide(leaderId, {
    kind: "artifact",
    artifactId: target.id,
    ...(target.version ? { version: target.version } : {}),
    ...(target.title ? { title: target.title } : {}),
  });
  return true;
}

/** Whether an artifact can open in a side column now: a leader's conversation is on screen. */
export function canOpenArtifactInSide(): boolean {
  const leaderId = useStore.getState().currentSessionId;
  return !!leaderId && readDisplayedLeaderThreadKey(leaderId) !== null;
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
