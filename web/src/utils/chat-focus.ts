import { createContext, useContext, useEffect, type FocusEvent, type PointerEvent } from "react";
import { create } from "zustand";

/**
 * One focused chat at a time, like windows in an OS window manager (Jiayi, Oct 31): with the main
 * view and side panes on screen together, several chats are visible and one is focused. Typing
 * outside an input goes to the focused chat's composer, and an answer that arrives by itself in a
 * chat that isn't focused stays unread (one the user scrolls to still reads).
 *
 * A click or tap anywhere in a chat focuses it, as does moving the keyboard focus into it or
 * opening it; moving the mouse or scrolling never does. On a phone the single view on screen is
 * always focused: a side sheet's chats use the main view's id.
 *
 * Browser-local UI state: focus belongs to this window, not to the session.
 */

/** The main view's chat. */
export const MAIN_CHAT = "main";

interface ChatFocusState {
  focused: string;
  /** Side panes on screen whose chat can take focus: while any is, the focused chat is marked. */
  sideChats: readonly string[];
}

export const useChatFocusStore = create<ChatFocusState>(() => ({ focused: MAIN_CHAT, sideChats: [] }));

/** The focus id of a side pane: its item. */
export function sideChatId(itemId: string): string {
  return `side:${itemId}`;
}

export function focusChat(id: string): void {
  if (useChatFocusStore.getState().focused !== id) useChatFocusStore.setState({ focused: id });
}

/** The chat that is focused now: a side pane only while it is on screen, else the main view. */
export function focusedChat(state: ChatFocusState = useChatFocusStore.getState()): string {
  return state.sideChats.includes(state.focused) ? state.focused : MAIN_CHAT;
}

export function useChatFocused(id: string): boolean {
  return useChatFocusStore((state) => focusedChat(state) === id);
}

/** Whether the focused chat is marked: only while a side pane shares the screen with the main view. */
export function useChatFocusMarked(id: string): boolean {
  return useChatFocusStore((state) => focusedChat(state) === id && state.sideChats.length > 0);
}

/**
 * Registers a side pane's chat while it is on screen. A focused pane that goes (closed, folded or
 * replaced) leaves the main view focused; deriving that, rather than moving focus when the pane
 * unregisters, keeps a pane whose registration merely re-runs from losing focus.
 */
export function useSideChat(id: string, onScreen: boolean): void {
  useEffect(() => {
    if (!onScreen) return;
    useChatFocusStore.setState((state) => ({ sideChats: [...state.sideChats, id] }));
    return () =>
      useChatFocusStore.setState((state) => ({ sideChats: state.sideChats.filter((other) => other !== id) }));
  }, [id, onScreen]);
}

/** The chat a component sits in: the main view unless a side pane provides its own id. */
export const ChatFocusContext = createContext<string>(MAIN_CHAT);

export function useChatFocusId(): string {
  return useContext(ChatFocusContext);
}

/**
 * Handlers for a chat's outermost element: a click or tap anywhere in it, or the keyboard focus
 * moving into it, focuses it. A press on a scrollbar scrolls without focusing, as in desktop apps.
 */
export function chatFocusHandlers(id: string): {
  onPointerDownCapture: (event: PointerEvent<HTMLElement>) => void;
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
} {
  return {
    onPointerDownCapture: (event) => {
      if (!onScrollbar(event)) focusChat(id);
    },
    onFocusCapture: () => focusChat(id),
  };
}

/** Whether a press landed on its target's own scrollbar rather than its content. */
function onScrollbar(event: PointerEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const rect = target.getBoundingClientRect();
  const vertical = target.offsetWidth - target.clientWidth;
  const horizontal = target.offsetHeight - target.clientHeight;
  return (
    (vertical > 0 && event.clientX >= rect.left + target.clientLeft + target.clientWidth) ||
    (horizontal > 0 && event.clientY >= rect.top + target.clientTop + target.clientHeight)
  );
}
