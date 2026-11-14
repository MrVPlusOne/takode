import { create } from "zustand";
import { setTopicPanelOpen, setTopicSheetOpen } from "./topic-panel.js";
import { readDisplayedLeaderThreadKey } from "./thread-viewport.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";
import { threadForMessagesOf } from "./leader-topics.js";
import { useStore } from "../store.js";
import { platformIsMac } from "../shortcuts.js";
import type { OpenInSideModifier } from "../../shared/shortcut-settings.js";
import { openLibraryArtifact } from "./library-nav.js";
import { isNewWindowClick, openArtifactWindow } from "./artifact-window.js";
import { setLocalStorageItem } from "./scoped-storage.js";
import { isRememberedFolded, setRememberedFolded } from "./remembered-folds.js";
import { sideConversationFeedKey, sideSessionFeedKey } from "../components/secondary-feed.js";
import { noteClickedPaneFeed, type ClickedPaneFeed } from "./pane-jump.js";

/**
 * What the side column holds besides the topic page it follows: things the user put there to keep
 * beside the main conversation (Logseq's right sidebar). One column for the whole app: what the
 * user put there stays when the main view switches to another leader or a worker's session (Jiayi,
 * Nov 1, 2026), and each conversation in it names its own leader. Newest first, shown by kind in
 * the column's tabs (`SideTab`), where one item at a time is open and fills the tab (remembered
 * folds, `sideFoldId`). Remembered in this browser: local UI state, like the column's width.
 */
export type SideItem =
  /** A topic's page, of its leader. */
  | { id: string; kind: "topic"; topicId: string; leaderId: string }
  /** A conversation of a leader: a quest's thread, a topic's conversation, or a thread. */
  | { id: string; kind: "conversation"; threadKey: string; leaderId: string }
  /**
   * A thread being started with a leader: its first message starts the thread. `startedFrom` is
   * the quest or thread the main view showed (`startedIn`, that view's leader); the new thread's
   * leader is told about it when it is its own thread, or a quest, the one kind every leader knows.
   */
  | { id: string; kind: "new-chat"; leaderId: string; startedFrom: string | null; startedIn?: string }
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
  | { id: string; kind: "session"; sessionId: string }
  /**
   * A leader's Home: its threads, where its Main conversation was. Beside the main view it is a
   * switcher: what is clicked there opens in the main view.
   */
  | { id: string; kind: "home"; leaderId: string };

export type SideItemInput = SideItem extends infer Item ? (Item extends SideItem ? Omit<Item, "id"> : never) : never;

/** The topic page the column follows (the topic of the main view's tab, or its leader's topic list). */
export const HOME_ITEM = "home";

export interface SideColumnState {
  items: SideItem[];
  /** The tab on screen; when it holds nothing now, the column shows its first tab. */
  tab?: SideTab;
  /** The item opened last (an item's ID or HOME_ITEM). */
  focus?: string;
  /** When it was opened, so opening it again focuses it again. */
  focusAt?: number;
}

const STORAGE_KEY = "cc-side-column";
/** Where each leader kept a column of its own, before there was one column. */
const LEADER_COLUMNS_KEY = "cc-side-columns";
const MAX_ITEMS = 16;

function stored(): SideColumnState {
  if (typeof localStorage === "undefined") return { items: [] };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      // Retired: the one-at-a-time switch (Nov 11), and the chats' use order and shared height,
      // which the scrolling column had before its tabs.
      const {
        oneAtATime: _switch,
        used: _used,
        chatHeight: _height,
        ...parsed
      } = JSON.parse(raw) as SideColumnState & { oneAtATime?: boolean; used?: string[]; chatHeight?: number };
      return { ...parsed, items: Array.isArray(parsed.items) ? parsed.items.map(asSideTarget) : [] };
    } catch (error) {
      console.warn("[side-column] Ignoring unreadable side column state:", error);
      return { items: [] };
    }
  }
  return mergeLeaderColumns(localStorage.getItem(LEADER_COLUMNS_KEY));
}

/**
 * The one column made from the columns leaders had of their own: everything any of them held,
 * leader by leader in the order they were first used, each item named with its leader, keeping
 * the folds it had; the same thing kept twice stays once. The leaders' columns go.
 */
export function mergeLeaderColumns(raw: string | null): SideColumnState {
  if (!raw) return { items: [] };
  let columns: Record<string, { items?: Array<Record<string, unknown>> }>;
  try {
    columns = JSON.parse(raw) as typeof columns;
  } catch (error) {
    console.warn("[side-column] Ignoring the unreadable side columns of leaders:", error);
    return { items: [] };
  }
  const items: SideItem[] = [];
  for (const [columnId, column] of Object.entries(columns)) {
    for (const old of column?.items ?? []) {
      const kind = old.kind;
      const owned = kind === "conversation" || kind === "new-chat" || kind === "topic";
      const item = {
        ...old,
        ...(owned && typeof old.leaderId !== "string" ? { leaderId: columnId } : {}),
        ...(kind === "new-chat" ? { startedIn: columnId } : {}),
      } as SideItem;
      if (typeof item.id !== "string" || items.some((kept) => sameTarget(kept, item))) continue;
      items.push(item);
      if (isRememberedFolded(`side:${columnId}:${item.id}`)) setRememberedFolded(sideFoldId(item.id), true);
    }
  }
  const kept = items.slice(0, MAX_ITEMS);
  setLocalStorageItem(STORAGE_KEY, JSON.stringify({ items: kept }));
  localStorage.removeItem(LEADER_COLUMNS_KEY);
  return { items: kept };
}

export const useSideColumnStore = create<SideColumnState>(() => stored());

function update(change: (column: SideColumnState) => SideColumnState): void {
  const next = change(useSideColumnStore.getState());
  useSideColumnStore.setState(next, true);
  setLocalStorageItem(STORAGE_KEY, JSON.stringify(next));
}

/** The leader an item belongs to: a conversation's, a thread being started's, a topic's or a Home's; none for others. */
export function sideItemLeader(item: SideItemInput): string | null {
  return item.kind === "conversation" || item.kind === "new-chat" || item.kind === "topic" || item.kind === "home"
    ? item.leaderId
    : null;
}

function sameTarget(a: SideItemInput, b: SideItemInput): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "topic":
      return a.topicId === (b as typeof a).topicId && a.leaderId === (b as typeof a).leaderId;
    case "conversation":
      return (
        a.threadKey.toLowerCase() === (b as typeof a).threadKey.toLowerCase() && a.leaderId === (b as typeof a).leaderId
      );
    case "new-chat":
      // One thread being started per leader it is with.
      return a.leaderId === (b as typeof a).leaderId;
    case "artifact":
      return a.artifactId === (b as typeof a).artifactId;
    case "quest":
      return a.questId.toLowerCase() === (b as typeof a).questId.toLowerCase();
    case "session":
      return a.sessionId === (b as typeof a).sessionId;
    case "home":
      return a.leaderId === (b as typeof a).leaderId;
  }
}

/** A leader's Main is its Home: opening it in the column opens the Home. */
function asSideTarget<Item extends SideItem | SideItemInput>(input: Item): Item {
  if (input.kind !== "conversation" || input.threadKey.toLowerCase() !== "main") return input;
  const { threadKey: _main, ...rest } = input;
  return { ...rest, kind: "home" } as unknown as Item;
}

/**
 * The kinds of what was put in the column (Jiayi, Nov 6: a quest's page in among the chats read as
 * one more chat): its chats, quest pages, and other pages (artifacts, Homes, pinned topic pages).
 */
export type SideGroup = "chats" | "quests" | "pages";

/** The column's groups, in the order of their tabs. */
export const SIDE_GROUPS: readonly SideGroup[] = ["chats", "quests", "pages"];

/**
 * A tab of the column: a group of what was put there, or the topic page the column follows. The
 * column shows one tab at a time, which fills it, so the column itself never scrolls (Jiayi, Nov 14:
 * the column scrolled as a whole and its open chat scrolled inside it, and a scrolled column hid the
 * chat's top).
 */
export type SideTab = SideGroup | "topic";

/** The group an item shows in. */
export function sideItemGroup(item: Pick<SideItem, "kind">): SideGroup {
  return isChatItem(item) ? "chats" : item.kind === "quest" ? "quests" : "pages";
}

/** The tab an item of the column (or the topic page it follows, HOME_ITEM) shows in. */
export function sideTabOf(id: string): SideTab {
  const item = useSideColumnStore.getState().items.find((candidate) => candidate.id === id);
  return item ? sideItemGroup(item) : "topic";
}

/** Shows a tab of the column. */
export function selectSideTab(tab: SideTab): void {
  if (useSideColumnStore.getState().tab !== tab) update((column) => ({ ...column, tab }));
}

/** The remembered fold of an item of the column, or of the topic page it follows (HOME_ITEM). */
export function sideFoldId(itemId: string): string {
  return `side:${itemId}`;
}

/** Items with a live feed of their own, which unmounts while folded. */
export function isConversationItem(item: Pick<SideItem, "kind">): boolean {
  return item.kind === "conversation" || item.kind === "session";
}

/**
 * Items that are a chat: a conversation, a thread being started, or another session's conversation.
 * Jiayi browses side chats one click at a time (Nov 2; the only way since Nov 11), and since the
 * column's tabs every tab works so: opening an item folds the others of its tab, and the open one
 * fills the tab. At most one is open, possibly none.
 */
export function isChatItem(item: Pick<SideItem, "kind">): boolean {
  return item.kind === "conversation" || item.kind === "new-chat" || item.kind === "session";
}

/** Unfolds an item, folding the others of its tab. */
export function unfoldSideItem(id: string): void {
  foldOthersInTab(id);
  setRememberedFolded(sideFoldId(id), false);
}

function foldOthersInTab(id: string): void {
  const { items } = useSideColumnStore.getState();
  const opened = items.find((item) => item.id === id);
  if (!opened) return;
  for (const other of items) {
    if (other.id === id || sideItemGroup(other) !== sideItemGroup(opened)) continue;
    if (!isRememberedFolded(sideFoldId(other.id))) setRememberedFolded(sideFoldId(other.id), true);
  }
}

/**
 * A column saved with several items of a tab open (from before the tabs, when pages opened on their
 * own and the column scrolled) keeps one open in each: the one opened last if it is open, else the
 * first open one.
 */
function keepOneOpenPerTab(): void {
  const { items, focus } = useSideColumnStore.getState();
  for (const group of SIDE_GROUPS) {
    const open = items.filter((item) => sideItemGroup(item) === group && !isRememberedFolded(sideFoldId(item.id)));
    const kept = open.find((item) => item.id === focus) ?? open[0];
    if (kept) foldOthersInTab(kept.id);
  }
}

/** Opens an item (or the topic page, HOME_ITEM) in its tab, and shows that tab. */
export function focusSideItem(id: string): void {
  if (id !== HOME_ITEM) unfoldSideItem(id);
  update((column) => ({ ...column, tab: sideTabOf(id), focus: id, focusAt: Date.now() }));
}

/**
 * Puts something in the side column, or brings it back to the top if it is there already, unfolds
 * it, scrolls the column to it and shows the column (on phones, its sheet).
 */
export function openInSide(opened: SideItemInput): string {
  return openInSideFrom(paneClick?.itemId ?? null, opened);
}

/** `openInSide` for a click made in `pane` (a side column item's ID, or null for elsewhere). */
function openInSideFrom(pane: string | null, opened: SideItemInput): string {
  const input = asSideTarget(opened);
  // A link clicked in one of the column's panes opens in that pane, in place of what it showed.
  if (pane && useSideColumnStore.getState().items.some((item) => item.id === pane)) {
    replaceSideItem(pane, input);
    focusSideItem(pane);
    return pane;
  }
  let id = "";
  update((column) => {
    const existing = column.items.find((item) => sameTarget(item, input));
    const item = existing ? ({ ...existing, ...input } as SideItem) : ({ ...input, id: newId() } as SideItem);
    id = item.id;
    return {
      ...column,
      items: [item, ...column.items.filter((other) => other.id !== item.id)].slice(0, MAX_ITEMS),
    };
  });
  focusSideItem(id);
  setTopicPanelOpen(true);
  setTopicSheetOpen(true);
  return id;
}

/** Shows the main view's leader's topics (the column's Topic tab). */
export function openTopicsInSide(): void {
  focusSideItem(HOME_ITEM);
  setTopicPanelOpen(true);
  setTopicSheetOpen(true);
}

/**
 * Takes an item out of the column. Taking out the open item of a tab opens another of that tab in
 * its place, so a tab doesn't fold to nothing (Jiayi, Nov 3, for chats): the one below it, else the
 * one above, so closing them one by one reads them top to bottom (Jiayi, Nov 10).
 */
export function closeSideItem(id: string): void {
  const before = useSideColumnStore.getState();
  const index = before.items.findIndex((item) => item.id === id);
  const closed = before.items[index];
  const reopen = closed && !isRememberedFolded(sideFoldId(id)) ? nextInTabAfterClosing(before, index) : undefined;
  update((column) => ({ ...column, items: column.items.filter((item) => item.id !== id) }));
  if (reopen) unfoldSideItem(reopen);
}

/** The item to open after the open one at `index` goes: the next one down its tab, else the one above. */
function nextInTabAfterClosing(column: SideColumnState, index: number): string | undefined {
  const group = sideItemGroup(column.items[index]!);
  const sameTab = (item: SideItem) => sideItemGroup(item) === group;
  const below = column.items.slice(index + 1).find(sameTab);
  const above = column.items.slice(0, index).reverse().find(sameTab);
  return (below ?? above)?.id;
}

/**
 * Turns an item into another in place, such as a new thread into its conversation once it started.
 * Another item showing the same thing goes, so the column never holds it twice.
 */
export function replaceSideItem(id: string, replacement: SideItemInput): void {
  const input = asSideTarget(replacement);
  update((column) => {
    const twin = column.items.find((item) => item.id !== id && sameTarget(item, input));
    return {
      ...column,
      items: column.items
        .filter((item) => item !== twin)
        .map((item) => (item.id === id ? ({ ...input, id } as SideItem) : item)),
      ...(twin && column.focus === twin.id ? { focus: id } : {}),
    };
  });
}

export function useSideColumn(): SideColumnState {
  return useSideColumnStore((state) => state);
}

function newId(): string {
  return `side-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * What a thread started now with a leader is about: the quest or topic thread the main view shows
 * when that is the leader on screen (a quest from any leader's view, since every leader knows
 * quests); none from Main or All.
 */
export function newSideChat(leaderId: string): SideItemInput {
  // A leader's conversation in the main view says which of its threads it shows.
  const onScreen = useMainViewStore.getState().sessionId;
  const key = onScreen ? (readDisplayedLeaderThreadKey(onScreen)?.toLowerCase() ?? "") : "";
  const quest = /^q-\d+$/.test(key);
  const startedFrom = quest || (onScreen === leaderId && key.startsWith("topic:")) ? key : null;
  return { kind: "new-chat", leaderId, startedFrom, ...(startedFrom && onScreen ? { startedIn: onScreen } : {}) };
}

/** The conversation the main view shows, as its view reports it while on screen (`showMainView`). */
export const useMainViewStore = create<{ sessionId: string | null; threadKey: string | null }>(() => ({
  sessionId: null,
  threadKey: null,
}));

/** The main view shows this session's thread; returns the cleanup for when it no longer does. */
export function showMainView(sessionId: string, threadKey: string | null): () => void {
  useMainViewStore.setState({ sessionId, threadKey });
  const key = threadKey?.toLowerCase();
  if (key && key !== "main" && key !== ALL_THREADS_KEY) lastThreadShown.set(sessionId, key);
  return () => {
    const now = useMainViewStore.getState();
    if (now.sessionId === sessionId && now.threadKey === threadKey)
      useMainViewStore.setState({ sessionId: null, threadKey: null });
  };
}

/** The thread each leader's main view showed last, other than its Home and its log. */
const lastThreadShown = new Map<string, string>();

/** The thread a leader's main view showed last, other than its Home and its log (this page load). */
export function lastThreadShownOf(leaderId: string): string | null {
  return lastThreadShown.get(leaderId) ?? null;
}

/** The leader of a session: itself when a leader, else the leader that herds it; null for neither. */
function leaderOfSession(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const session = useStore.getState().sdkSessions.find((candidate) => candidate.sessionId === sessionId);
  if (session?.isOrchestrator) return sessionId;
  return session?.herdedBy ?? null;
}

/** The leader the column's leader-dependent sections (Topics) follow: the main view's. */
export function mainViewLeader(): string | null {
  return leaderOfSession(useMainViewStore.getState().sessionId);
}

/** `mainViewLeader`, as it changes. */
export function useMainViewLeader(): string | null {
  const sessionId = useMainViewStore((state) => state.sessionId);
  return useStore((state) => {
    if (!sessionId) return null;
    const session = state.sdkSessions.find((candidate) => candidate.sessionId === sessionId);
    return session?.isOrchestrator ? sessionId : (session?.herdedBy ?? null);
  });
}

/** The modifier keys of a click, enough to tell whether it opens something in the side column. */
export interface OpenInSideEvent {
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** A click being dispatched inside one of the side column's panes (`notePaneClick`). */
let paneClick: { itemId: string | null; event: OpenInSideEvent } | null = null;

/**
 * Records that a click is happening in a side column's pane (its item, or null for the topic page
 * it follows), for the click's own handlers: a link there opens in that pane, and the open-in-side
 * click opens it in the main view instead. Called in the capture phase; forgotten once the click
 * is handled.
 */
export function notePaneClick(itemId: string | null, event: OpenInSideEvent): void {
  const click = { itemId, event: { ...pickModifiers(event) } };
  paneClick = click;
  // A plain click there jumps to the pane's own messages in the pane (`navigateToSessionMessageId`).
  noteClickedPaneFeed(isOtherColumnClick(event) ? null : paneFeedOf(itemId));
  setTimeout(() => {
    if (paneClick === click) paneClick = null;
  }, 0);
}

/**
 * Whether a click should land in the side column: in the main view, the open-in-side click; in a
 * side pane, a plain click (a click opens in the view it was made in, the other click in the other).
 */
export function wantsSideClick(event: OpenInSideEvent | undefined = paneClick?.event): boolean {
  return paneClick ? !isOtherColumnClick(event) : isOtherColumnClick(event);
}

/** The feed of a side column item that shows a conversation, for jumps to its messages. */
function paneFeedOf(itemId: string | null): ClickedPaneFeed | null {
  const item = useSideColumnStore.getState().items.find((entry) => entry.id === itemId);
  if (item?.kind === "conversation") {
    const threadKey = item.threadKey.toLowerCase();
    return { sessionId: item.leaderId, threadKey, feedKey: sideConversationFeedKey(item.leaderId, threadKey) };
  }
  if (item?.kind === "session") {
    return { sessionId: item.sessionId, threadKey: MAIN_THREAD_KEY, feedKey: sideSessionFeedKey(item.sessionId) };
  }
  return null;
}

/** Whether the click being handled was made in a side column's pane. */
export function isPaneClick(): boolean {
  return paneClick !== null;
}

function pickModifiers(event: OpenInSideEvent): OpenInSideEvent {
  return { shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
}

/**
 * Whether a click asks for the other column: a click with the key chosen in Settings > Keyboard held,
 * and no other (Shift-click by default, like Logseq). A link clicked so in the main view opens in
 * the side column and one in a side pane in the main view (`wantsSideClick`); on a button that moves
 * a chat between the two, it keeps the chat in both.
 */
export function isOtherColumnClick(event: OpenInSideEvent | undefined, chosen?: OpenInSideModifier): boolean {
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

/** How the other-column click is named, for tooltips: "Shift-click". */
export function otherColumnClickLabel(
  modifier: OpenInSideModifier = useStore.getState().shortcutSettings?.openInSideModifier ?? "shift",
): string {
  const mac = platformIsMac(currentPlatform());
  const key = { shift: "Shift", alt: mac ? "Option" : "Alt" }[modifier];
  return `${key}-click`;
}

/** `otherColumnClickLabel` for a tooltip, following the setting while it is on screen. */
export function useOtherColumnClickLabel(): string {
  return otherColumnClickLabel(useStore((state) => state.shortcutSettings?.openInSideModifier ?? "shift"));
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

/** Whether a side column is on screen to open things in: a session's conversation is in the main view. */
export function sideColumnOnScreen(): boolean {
  return useMainViewStore.getState().sessionId !== null;
}

/** Opens something in the side column; false when there is none on screen. */
export function openInSideOnScreen(input: SideItemInput): boolean {
  if (!sideColumnOnScreen()) return false;
  openInSide(input);
  return true;
}

/**
 * Opens an artifact where a click asks: in a window of its own on Cmd/Ctrl-click, in the side
 * column on an open-in-side click, else in the Library (also when no conversation is on screen).
 */
export function openArtifact(target: { id: string; version?: number; title?: string }, event?: OpenInSideEvent): void {
  if (isNewWindowClick(event)) {
    openArtifactWindow(target);
    return;
  }
  if (isOtherColumnClick(event) && openArtifactInSide(target)) return;
  openLibraryArtifact(target.id, target.version);
}

/** Opens an artifact in the side column; false when there is none on screen. */
export function openArtifactInSide(target: { id: string; version?: number; title?: string }): boolean {
  return openInSideOnScreen({
    kind: "artifact",
    artifactId: target.id,
    ...(target.version ? { version: target.version } : {}),
    ...(target.title ? { title: target.title } : {}),
  });
}

/** Opens a quest's details in the side column; false when there is none on screen. */
export function openQuestInSide(questId: string): boolean {
  return openInSideOnScreen({ kind: "quest", questId: questId.toLowerCase() });
}

/**
 * Opens a session's conversation in the side column; false when there is none on screen. A
 * leader opens as its Home.
 */
export function openSessionInSide(sessionId: string): boolean {
  const leader = leaderOfSession(sessionId) === sessionId;
  return openInSideOnScreen(leader ? { kind: "home", leaderId: sessionId } : { kind: "session", sessionId });
}

/** A message of a session's conversation: its ID and the thread it belongs to (none: its Main). */
export interface SessionMessageTarget {
  messageId: string;
  threadKey?: string;
}

/**
 * Opens a message of a session's conversation in the side column, in the thread it belongs to (a
 * leader's Main messages in its leader log, as the main view shows them), scrolled to it; false when
 * there is no side column on screen. `target` finds the message after the click, so the pane the
 * click was made in is noted now and the message opens in place of it. With no message found, the
 * session opens as `openSessionInSide` opens it.
 */
export function openSessionMessageInSide(sessionId: string, target: Promise<SessionMessageTarget | null>): boolean {
  if (!sideColumnOnScreen()) return false;
  const pane = paneClick?.itemId ?? null;
  target
    .catch((error: unknown) => {
      console.warn("[side-column] Could not find a linked message; opening its session:", error);
      return null;
    })
    .then((found) => openMessageFrom(pane, sessionId, found));
  return true;
}

function openMessageFrom(pane: string | null, sessionId: string, found: SessionMessageTarget | null): void {
  const leader = leaderOfSession(sessionId) === sessionId;
  if (!found) {
    openInSideFrom(pane, leader ? { kind: "home", leaderId: sessionId } : { kind: "session", sessionId });
    return;
  }
  const threadKey = normalizeThreadKey(threadForMessagesOf(sessionId, found.threadKey ?? MAIN_THREAD_KEY));
  const feedKey = leader ? sideConversationFeedKey(sessionId, threadKey) : sideSessionFeedKey(sessionId);
  openInSideFrom(
    pane,
    leader ? { kind: "conversation", threadKey, leaderId: sessionId } : { kind: "session", sessionId },
  );
  // The pane's feed jumps to the message once it shows it, loading the message's window if needed.
  const store = useStore.getState();
  store.requestScrollToMessage(sessionId, found.messageId, feedKey);
  store.setExpandAllInTurn(sessionId, found.messageId);
}

/** Whether something can open in the side column now: a conversation is on screen. */
export function canOpenInSide(): boolean {
  return sideColumnOnScreen();
}

/**
 * Opens a leader's quest or thread in the side column. Returns false when no conversation is on
 * screen, so the click does what it would.
 */
export function openConversationInSide(leaderId: string, threadKey: string): boolean {
  return openInSideOnScreen({ kind: "conversation", threadKey: threadKey.toLowerCase(), leaderId });
}

keepOneOpenPerTab();
