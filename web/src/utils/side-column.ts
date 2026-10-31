import { create } from "zustand";
import { setTopicPanelOpen, setTopicSheetOpen } from "./topic-panel.js";
import { readDisplayedLeaderThreadKey } from "./thread-viewport.js";
import { useStore } from "../store.js";
import { platformIsMac } from "../shortcuts.js";
import type { OpenInSideModifier } from "../../shared/shortcut-settings.js";
import { openLibraryArtifact } from "./library-nav.js";
import { isNewWindowClick, openArtifactWindow } from "./artifact-window.js";
import { setLocalStorageItem } from "./scoped-storage.js";

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
  | {
      id: string;
      kind: "artifact";
      artifactId: string;
      version?: number;
      title?: string;
    }
  /** A quest's details (what a click on a quest link shows), of any leader. */
  | { id: string; kind: "quest"; questId: string }
  /** Another session's conversation (what a click on a session link opens), such as a worker's. */
  | { id: string; kind: "session"; sessionId: string };

export type SideItemInput = SideItem extends infer Item ? (Item extends SideItem ? Omit<Item, "id"> : never) : never;

/** The topic page the column follows (the tab's topic, or the leader's topic list). */
export const HOME_ITEM = "home";

/** No item open: the user folded the one that was. */
export const NO_ITEM = "";

interface LeaderColumn {
  items: SideItem[];
  /** The item shown open: an item's ID, HOME_ITEM, or NO_ITEM when the user folded the open one. */
  open: string;
  /** The user folded the leader's overview at the column's top. */
  overviewFolded?: boolean;
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
  setLocalStorageItem(STORAGE_KEY, JSON.stringify(columns));
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
    case "quest":
      return a.questId.toLowerCase() === (b as typeof a).questId.toLowerCase();
    case "session":
      return a.sessionId === (b as typeof a).sessionId;
  }
}

/**
 * Puts something in a leader's side column, or brings it back to the top if it is there already,
 * opens it and shows the column (on phones, its sheet).
 */
export function openInSide(leaderId: string, input: SideItemInput): string {
  // A link clicked in one of the column's panes opens in that pane, in place of what it showed.
  const pane = paneClick?.leaderId === leaderId ? paneClick.itemId : null;
  if (pane && useSideColumnStore.getState().columns[leaderId]?.items.some((item) => item.id === pane)) {
    replaceSideItem(leaderId, pane, input);
    openSideItem(leaderId, pane);
    return pane;
  }
  let id = "";
  update(leaderId, (column) => {
    const existing = column.items.find((item) => sameTarget(item, input));
    const item = existing ? ({ ...existing, ...input } as SideItem) : ({ ...input, id: newId() } as SideItem);
    id = item.id;
    return {
      ...column,
      items: [item, ...column.items.filter((other) => other.id !== item.id)].slice(0, MAX_ITEMS),
      open: item.id,
    };
  });
  setTopicPanelOpen(leaderId, true);
  setTopicSheetOpen(leaderId, true);
  return id;
}

/** Opens one of the column's items (or HOME_ITEM), folding the one open before; NO_ITEM folds it. */
export function openSideItem(leaderId: string, id: string): void {
  update(leaderId, (column) => ({ ...column, open: id }));
}

/** Folds or unfolds the leader's overview at the column's top. */
export function setSideOverviewFolded(leaderId: string, folded: boolean): void {
  update(leaderId, (column) => ({ ...column, overviewFolded: folded }));
}

/** Takes an item out of the column; the one after it opens if it was open. */
export function closeSideItem(leaderId: string, id: string): void {
  update(leaderId, (column) => {
    const index = column.items.findIndex((item) => item.id === id);
    const items = column.items.filter((item) => item.id !== id);
    if (column.open !== id) return { ...column, items };
    const next = items[Math.min(index, items.length - 1)];
    return { ...column, items, open: next?.id ?? HOME_ITEM };
  });
}

/**
 * Turns an item into another in place, such as a new side chat into its thread once it started.
 * Another item showing the same thing goes, so the column never holds it twice.
 */
export function replaceSideItem(leaderId: string, id: string, input: SideItemInput): void {
  update(leaderId, (column) => {
    const twin = column.items.find((item) => item.id !== id && sameTarget(item, input));
    return {
      ...column,
      items: column.items
        .filter((item) => item !== twin)
        .map((item) => (item.id === id ? ({ ...input, id } as SideItem) : item)),
      open: twin && column.open === twin.id ? id : column.open,
    };
  });
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

/** A click being dispatched inside one of a side column's panes (`notePaneClick`). */
let paneClick: { leaderId: string; itemId: string | null; event: OpenInSideEvent } | null = null;

/**
 * Records that a click is happening in a side column's pane (its item, or null for the topic page
 * it follows), for the click's own handlers: a link there opens in that pane, and the open-in-side
 * click opens it in the main view instead. Called in the capture phase; forgotten once the click
 * is handled.
 */
export function notePaneClick(leaderId: string, itemId: string | null, event: OpenInSideEvent): void {
  const click = { leaderId, itemId, event: { ...pickModifiers(event) } };
  paneClick = click;
  setTimeout(() => {
    if (paneClick === click) paneClick = null;
  }, 0);
}

/**
 * Whether a click should land in the side column: in the main view, the open-in-side click; in a
 * side pane, a plain click (a click opens in the view it was made in, the other click in the other).
 */
export function wantsSideClick(event: OpenInSideEvent | undefined = paneClick?.event): boolean {
  return paneClick ? !isOpenInSideClick(event) : isOpenInSideClick(event);
}

/** Whether the click being handled was made in a side column's pane. */
export function isPaneClick(): boolean {
  return paneClick !== null;
}

function pickModifiers(event: OpenInSideEvent): OpenInSideEvent {
  return { shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
}

/**
 * Whether a click asks to open its target in the side column rather than the main view: a click
 * with the key chosen in Settings > Keyboard held, and no other (Shift-click by default, like Logseq).
 */
export function isOpenInSideClick(event: OpenInSideEvent | undefined, chosen?: OpenInSideModifier): boolean {
  // A plain click is never one; the setting is read only for a click with a key held.
  if (!event || !(event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)) return false;
  const modifier = chosen ?? useStore.getState().shortcutSettings?.openInSideModifier ?? "shift";
  const held = {
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
  };
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
 * For an in-app link's click: a click that should land in the side column (`wantsSideClick`)
 * opens what `openInSideColumn` names there, in place of the pane it was made in, and the browser
 * never gets it (Chrome opens Shift-clicked links in a new window). When there is no side column
 * to open it in (no leader's conversation on screen), the click does what a plain click does
 * (`plainClick`); so does the open-in-side click made in a side pane. Returns whether it was handled
 * here; a plain click in the main view is the caller's.
 */
export function handleOpenInSideClick(
  event: OpenInSideEvent & { preventDefault?: () => void },
  openInSideColumn: () => boolean,
  plainClick: () => void,
): boolean {
  const inPane = paneClick !== null;
  if (!wantsSideClick(event)) {
    // The open-in-side click in a side pane opens in the main view; the browser never gets it.
    if (!inPane) return false;
    event.preventDefault?.();
    plainClick();
    return true;
  }
  event.preventDefault?.();
  if (!openInSideColumn()) plainClick();
  return true;
}

/** The leader whose side column is on screen: the session on screen, when a leader's conversation. */
export function sideColumnOnScreen(): string | null {
  const leaderId = useStore.getState().currentSessionId;
  return leaderId && readDisplayedLeaderThreadKey(leaderId) !== null ? leaderId : null;
}

/** Opens something in the side column on screen; false when there is none. */
export function openInSideOnScreen(input: SideItemInput): boolean {
  const leaderId = sideColumnOnScreen();
  if (!leaderId) return false;
  openInSide(leaderId, input);
  return true;
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

/** Opens an artifact in the side column on screen; false when there is none. */
export function openArtifactInSide(target: { id: string; version?: number; title?: string }): boolean {
  return openInSideOnScreen({
    kind: "artifact",
    artifactId: target.id,
    ...(target.version ? { version: target.version } : {}),
    ...(target.title ? { title: target.title } : {}),
  });
}

/** Opens a quest's details in the side column on screen; false when there is none. */
export function openQuestInSide(questId: string): boolean {
  return openInSideOnScreen({ kind: "quest", questId: questId.toLowerCase() });
}

/**
 * Opens a session's conversation in the side column on screen; false when there is none. The
 * leader on screen itself opens as its Main thread.
 */
export function openSessionInSide(sessionId: string): boolean {
  const leaderId = sideColumnOnScreen();
  if (!leaderId) return false;
  openInSide(
    leaderId,
    sessionId === leaderId ? { kind: "conversation", threadKey: "main" } : { kind: "session", sessionId },
  );
  return true;
}

/** Whether something can open in a side column now: a leader's conversation is on screen. */
export function canOpenInSide(): boolean {
  return sideColumnOnScreen() !== null;
}

/**
 * Opens a leader's quest or thread in its side column, when that leader's conversation is on screen
 * (the side column belongs to it). Returns false when it isn't, so the click does what it would.
 */
export function openConversationInSide(leaderId: string, threadKey: string): boolean {
  if (readDisplayedLeaderThreadKey(leaderId) === null) return false;
  openInSide(leaderId, {
    kind: "conversation",
    threadKey: threadKey.toLowerCase(),
  });
  return true;
}
