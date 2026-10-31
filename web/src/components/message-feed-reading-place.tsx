import { Component, type RefObject } from "react";
import type { TurnCollapseState } from "../hooks/use-collapse-policy.js";
import { useStore } from "../store.js";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { useComposerTarget } from "./composer-target.js";
import { escapeSelectorValue } from "./message-feed-utils.js";

interface ReadingPlace {
  element: HTMLElement;
  /** Distance from the feed's top edge, in the visual pixels the jump pin holds. */
  offsetTop: number;
}

/**
 * The message the reader is looking at: the last of `preferredMessageIds` on screen (the messages the
 * reader's comments are on), else the last message starting above the middle of the feed.
 */
export function findReadingPlace(
  container: HTMLElement,
  preferredMessageIds: readonly string[] = [],
): ReadingPlace | null {
  const bounds = container.getBoundingClientRect();
  if (bounds.height <= 0) return null;
  const placeOf = (element: HTMLElement): ReadingPlace | null => {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return null;
    return { element, offsetTop: rect.top - bounds.top };
  };
  for (const id of [...preferredMessageIds].reverse()) {
    const element = container.querySelector<HTMLElement>(`[data-message-id="${escapeSelectorValue(id)}"]`);
    const place = element && placeOf(element);
    if (place) return place;
  }
  let place: ReadingPlace | null = null;
  for (const element of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const candidate = placeOf(element);
    if (!candidate) continue;
    // A message starting below the middle counts only when it is the first one on screen.
    if (candidate.offsetTop > bounds.height / 2) return place ?? candidate;
    place = candidate;
  }
  return place;
}

/**
 * Keeps the latest turn open past the user's next message when the reader is looking at it. A new
 * message starts a turn and folds the one before into its summary, which pulled what the reader was
 * looking at out from under them.
 */
export function keepLatestTurnOpenIfOnScreen(
  container: HTMLElement | null,
  sessionId: string,
  turnStates: readonly TurnCollapseState[],
) {
  const latest = turnStates.at(-1);
  if (!container || !latest?.isActivityExpanded) return;
  const turn = container.querySelector<HTMLElement>(`[data-turn-id="${escapeSelectorValue(latest.turnId)}"]`);
  if (!turn) return;
  const bounds = container.getBoundingClientRect();
  const rect = turn.getBoundingClientRect();
  if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return;
  // Once it is no longer the latest turn its fold choice is keyed by its own id.
  useStore.getState().keepTurnExpanded(sessionId, latest.turnId);
}

const NO_COMMENTS: readonly ConversationAnnotation[] = [];
const commentIdsOf = (comments: readonly ConversationAnnotation[]) => comments.map((comment) => comment.id).join(",");

type KeeperSnapshot = { place: ReadingPlace | null; sent: boolean } | null;

interface KeeperProps {
  containerRef: RefObject<HTMLDivElement | null>;
  /** The session's send request: true from a send until the feed has taken it. */
  sending: boolean;
  /** The comments in this conversation's composer. */
  comments: readonly ConversationAnnotation[];
  /** Whether the feed follows its bottom; a following reader stays at the bottom instead. */
  followingRef: { current: boolean };
  hold: (target: HTMLElement, offsetTop: number) => void;
  onSendWhileReading: () => void;
}

/**
 * Records where a scrolled-up reader is just before a send or a comment change reaches the DOM, then
 * holds that place. Saving or sending comments adds or removes "Include my comments" on every open
 * question card, and a send is followed by the message landing and a thread window refresh; browsers
 * without scroll anchoring (Safari) moved the reader by each of these. The place must be read before
 * React changes the DOM, which is what `getSnapshotBeforeUpdate` is for: a layout effect would see the
 * cards already changed. While commenting, the reader is at their commented passages, so those
 * messages are held rather than whatever is mid-feed (a card can sit between the two).
 */
class ReadingPlaceKeeper extends Component<KeeperProps> {
  getSnapshotBeforeUpdate(previous: KeeperProps): KeeperSnapshot {
    const sent = this.props.sending && !previous.sending;
    if (!sent && commentIdsOf(this.props.comments) === commentIdsOf(previous.comments)) return null;
    const container = this.props.containerRef.current;
    if (!container || this.props.followingRef.current) return null;
    // A send takes the comments out of the draft, so the ones just sent are in `previous`.
    const commented = [...previous.comments, ...this.props.comments].flatMap((comment) =>
      comment.sourceMessageId ? [comment.sourceMessageId] : [],
    );
    return { place: findReadingPlace(container, commented), sent };
  }

  componentDidUpdate(_previous: KeeperProps, _state: unknown, snapshot: KeeperSnapshot) {
    if (!snapshot) return;
    if (snapshot.sent) this.props.onSendWhileReading();
    if (snapshot.place) this.props.hold(snapshot.place.element, snapshot.place.offsetTop);
  }

  render() {
    return null;
  }
}

/**
 * Keeps a scrolled-up reader exactly where they are when they send a message or comments, or save or
 * remove a comment. A reader following the bottom keeps following instead.
 */
export function KeepReadingPlace({
  sessionId,
  containerRef,
  followingRef,
  turnStatesRef,
  hold,
}: {
  sessionId: string;
  containerRef: RefObject<HTMLDivElement | null>;
  followingRef: { current: boolean };
  turnStatesRef: { current: readonly TurnCollapseState[] };
  hold: (target: HTMLElement, offsetTop: number) => void;
}) {
  const draftKey = useComposerTarget(sessionId);
  const sending = useStore((s) => s.bottomAlignNextUserMessage.has(sessionId));
  const comments = useStore((s) => s.composerDrafts.get(draftKey)?.annotations ?? NO_COMMENTS);
  return (
    <ReadingPlaceKeeper
      containerRef={containerRef}
      sending={sending}
      comments={comments}
      followingRef={followingRef}
      hold={hold}
      onSendWhileReading={() => keepLatestTurnOpenIfOnScreen(containerRef.current, sessionId, turnStatesRef.current)}
    />
  );
}
