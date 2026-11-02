import { createContext, useContext, useEffect, type TouchEvent, type WheelEvent } from "react";
import { create } from "zustand";

/**
 * One focused chat at a time, like windows in an OS window manager (Jiayi, Oct 31): with the main
 * view and side panes on screen together, several chats are visible and one is focused. Typing
 * outside an input goes to the focused chat's composer, and an answer that arrives by itself in a
 * chat that isn't focused stays unread.
 *
 * A click or tap anywhere in a chat focuses it, as does scrolling it (wheel, trackpad, touch or its
 * scrollbar), moving the keyboard focus into it or opening it; moving the mouse doesn't, nor do
 * scrolls the app makes itself (following new messages, jumps, restoring a place). Scrolling
 * focuses as a trial (Jiayi, Nov 1): users may not know the panes have a focus at all, and clicking
 * first felt wrong. On a phone the single view on screen is always focused: a side sheet's chats use
 * the main view's id.
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
 * Handlers for a chat's outermost element: a click or tap anywhere in it (its scrollbars included),
 * the keyboard focus moving into it, or a wheel or touch scroll of something inside it focuses it.
 * Only user input fires these, so the app's own scrolling never moves focus.
 */
export function chatFocusHandlers(id: string): {
  onPointerDownCapture: () => void;
  onFocusCapture: () => void;
  onWheelCapture: (event: WheelEvent<HTMLElement>) => void;
  onTouchMoveCapture: (event: TouchEvent<HTMLElement>) => void;
} {
  const onScroll = (event: { target: EventTarget; currentTarget: HTMLElement }) => {
    if (scrollsInside(event.target, event.currentTarget)) focusChat(id);
  };
  return {
    onPointerDownCapture: () => focusChat(id),
    onFocusCapture: () => focusChat(id),
    onWheelCapture: onScroll,
    onTouchMoveCapture: onScroll,
  };
}

/**
 * Whether a wheel or touch over `target` scrolls something inside the chat: an element between it
 * and the chat's root that scrolls. Over a side pane's title bar or its column scroll strip the
 * wheel scrolls the side column instead, which is not using the chat.
 */
function scrollsInside(target: EventTarget, root: HTMLElement): boolean {
  for (let element = target instanceof Element ? target : null; element && element !== root; ) {
    if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight) {
      const overflow = getComputedStyle(element).overflowY;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    element = element.parentElement;
  }
  return false;
}
