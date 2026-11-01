import { create } from "zustand";
import { setLocalStorageItem } from "./scoped-storage.js";

/**
 * The side column (with the main view's leader's topics at its foot). On desktop it is part of the
 * layout beside the conversation, open by default and collapsible to a slim rail; whether it is
 * collapsed is remembered in this browser. On phones it is a page that slides in from the right,
 * opened from the top bar. Someone can also ask to show a topic in a leader's topic page, such as
 * from the Done list or an artifact. Local UI state. One column for every leader (Nov 1, 2026);
 * each leader used to have its own.
 */
interface TopicPanelState {
  /** Desktop: open (true) or collapsed to the rail (false). */
  open: boolean;
  /** Phones: whether the sheet is open. */
  sheet: boolean;
  /** A topic to show in a leader's topic page instead of the one the tab on screen follows. */
  focus: { leaderId: string; topicId: string; at: number } | null;
}

const OPEN_KEY = "cc-side-column-open";
/** Where each leader's column remembered being collapsed, before there was one column. */
const LEADER_PANELS_KEY = "cc-topic-panels";

function storedOpen(): boolean {
  if (typeof localStorage === "undefined") return true;
  localStorage.removeItem(LEADER_PANELS_KEY);
  return localStorage.getItem(OPEN_KEY) !== "false";
}

export const useTopicPanel = create<TopicPanelState>(() => ({ open: storedOpen(), sheet: false, focus: null }));

/** Expands the desktop column or collapses it to the rail. */
export function setTopicPanelOpen(open: boolean): void {
  useTopicPanel.setState({ open });
  setLocalStorageItem(OPEN_KEY, String(open));
}

/** Opens or closes the phone sheet. */
export function setTopicSheetOpen(open: boolean): void {
  useTopicPanel.setState({ sheet: open });
}

/** Shows a topic in a leader's topic page, opening the column. */
export function openTopicInPanel(leaderId: string, topicId: string): void {
  setTopicPanelOpen(true);
  setTopicSheetOpen(true);
  useTopicPanel.setState({ focus: { leaderId, topicId, at: Date.now() } });
}

/** Whether the desktop column is expanded (rather than collapsed to the rail). */
export function useTopicPanelOpen(): boolean {
  return useTopicPanel((state) => state.open);
}

export function useTopicSheetOpen(): boolean {
  return useTopicPanel((state) => state.sheet);
}

/**
 * Topic pages a panel keeps mounted (hidden) besides the one on screen, so going back to one
 * shows it where it was left, like the kept conversations.
 */
export const KEPT_TOPIC_PAGES = 3;

export interface KeptTopicPage {
  topicId: string;
  /** First-shown order. Pages render in this order so a kept page's DOM never moves. */
  seq: number;
}

/**
 * The kept pages after showing `topicId` (null while the topic list is on screen): most recently
 * shown first, at most `limit`. Returns `kept` itself when nothing changed.
 */
export function nextKeptTopicPages(
  kept: KeptTopicPage[],
  topicId: string | null,
  limit = KEPT_TOPIC_PAGES,
): KeptTopicPage[] {
  if (!topicId || kept[0]?.topicId === topicId) return kept;
  const existing = kept.find((page) => page.topicId === topicId);
  const seq = existing?.seq ?? Math.max(-1, ...kept.map((page) => page.seq)) + 1;
  return [{ topicId, seq }, ...kept.filter((page) => page.topicId !== topicId)].slice(0, limit);
}
