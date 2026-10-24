import { create } from "zustand";

/**
 * A leader's topic panel. On desktop it is part of the layout beside the conversation, open by
 * default and collapsible to a slim rail; whether it is collapsed is remembered per leader in this
 * browser. On phones it is a page that slides in from the right, opened from the top bar. Someone can
 * also ask to show a topic in it, such as from the Done list or an artifact. Local UI state.
 */
interface TopicPanelState {
  /** Desktop, per leader: open (true) or collapsed to the rail (false); unset means open. */
  panels: Record<string, boolean>;
  /** Phones: leaders whose sheet is open. */
  sheets: string[];
  /** A topic to show in a leader's panel instead of the one the tab on screen follows. */
  focus: { leaderId: string; topicId: string; at: number } | null;
}

const PANELS_KEY = "cc-topic-panels";

function storedPanels(): Record<string, boolean> {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PANELS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  } catch (error) {
    console.warn("[library] Ignoring unreadable topic panel state:", error);
    return {};
  }
}

export const useTopicPanel = create<TopicPanelState>(() => ({ panels: storedPanels(), sheets: [], focus: null }));

/** Expands the desktop panel or collapses it to the rail. */
export function setTopicPanelOpen(leaderId: string, open: boolean): void {
  const panels = { ...useTopicPanel.getState().panels, [leaderId]: open };
  useTopicPanel.setState({ panels });
  localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
}

/** Opens or closes the phone sheet. */
export function setTopicSheetOpen(leaderId: string, open: boolean): void {
  const others = useTopicPanel.getState().sheets.filter((id) => id !== leaderId);
  useTopicPanel.setState({ sheets: open ? [...others, leaderId] : others });
}

/** Shows a topic in a leader's panel (or sheet), opening it. */
export function openTopicInPanel(leaderId: string, topicId: string): void {
  setTopicPanelOpen(leaderId, true);
  setTopicSheetOpen(leaderId, true);
  useTopicPanel.setState({ focus: { leaderId, topicId, at: Date.now() } });
}

/** Whether the desktop panel is expanded (rather than collapsed to the rail). */
export function useTopicPanelOpen(leaderId: string | null | undefined): boolean {
  return useTopicPanel((state) => !!leaderId && state.panels[leaderId] !== false);
}

export function useTopicSheetOpen(leaderId: string | null | undefined): boolean {
  return useTopicPanel((state) => !!leaderId && state.sheets.includes(leaderId));
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
