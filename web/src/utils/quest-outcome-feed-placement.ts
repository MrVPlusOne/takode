import type { FeedSection } from "../components/message-feed-sections.js";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { QuestOutcomeAnchor } from "../types.js";

export type QuestOutcomeFeedPlacement =
  | {
      kind: "before-turn";
      turnId: string;
      coveredTurnIds: Set<string>;
      newerTurnIds: Set<string>;
    }
  | {
      kind: "after-user";
      turnId: string;
      coveredTurnIds: Set<string>;
      newerTurnIds: Set<string>;
    }
  | {
      kind: "within-turn";
      turnId: string;
      afterMessageId: string;
      coveredTurnIds: Set<string>;
      newerTurnIds: Set<string>;
    }
  | {
      kind: "after-window";
      coveredTurnIds: Set<string>;
      newerTurnIds: Set<string>;
    }
  | { kind: "hidden"; coveredTurnIds: Set<string>; newerTurnIds: Set<string> };

function presentationEntries(turn: Turn): FeedEntry[] {
  return turn.presentationEntries ?? turn.allEntries;
}

function userBoundaryMessage(turn: Turn): Extract<FeedEntry, { kind: "message" }> | null {
  return turn.userEntry?.kind === "message" ? turn.userEntry : null;
}

function rootMessageEntries(turn: Turn): Array<Extract<FeedEntry, { kind: "message" }>> {
  return presentationEntries(turn).filter(
    (entry): entry is Extract<FeedEntry, { kind: "message" }> => entry.kind === "message",
  );
}

function turnHistoryIndexes(turn: Turn): number[] {
  return [userBoundaryMessage(turn), ...rootMessageEntries(turn)].flatMap((entry) =>
    entry && typeof entry.msg.historyIndex === "number" ? [entry.msg.historyIndex] : [],
  );
}

function placementAtSplit(turns: Turn[], splitIndex: number): QuestOutcomeFeedPlacement {
  const coveredTurnIds = new Set(turns.slice(0, splitIndex).map((turn) => turn.id));
  const newerTurnIds = new Set(turns.slice(splitIndex).map((turn) => turn.id));
  const next = turns[splitIndex];
  return next
    ? { kind: "before-turn", turnId: next.id, coveredTurnIds, newerTurnIds }
    : { kind: "after-window", coveredTurnIds, newerTurnIds };
}

function placementAfterUser(turns: Turn[], turnIndex: number): QuestOutcomeFeedPlacement {
  return {
    kind: "after-user",
    turnId: turns[turnIndex]!.id,
    coveredTurnIds: new Set(turns.slice(0, turnIndex).map((turn) => turn.id)),
    newerTurnIds: new Set(turns.slice(turnIndex).map((turn) => turn.id)),
  };
}

function placementWithinTurn(turns: Turn[], turnIndex: number, afterMessageId: string): QuestOutcomeFeedPlacement {
  return {
    kind: "within-turn",
    turnId: turns[turnIndex]!.id,
    afterMessageId,
    coveredTurnIds: new Set(turns.slice(0, turnIndex).map((turn) => turn.id)),
    newerTurnIds: new Set(turns.slice(turnIndex).map((turn) => turn.id)),
  };
}

function isDirectPostCompletionUserTurn(turn: Turn, completedAt: number): boolean {
  if (turn.userEntry?.kind !== "message") return false;
  const message = turn.userEntry.msg;
  return message.role === "user" && !message.agentSource && message.timestamp > completedAt;
}

function anchorIsPostCompletion(
  turns: Turn[],
  anchor: QuestOutcomeAnchor | undefined,
  sessionId: string,
  completedAt: number,
): boolean {
  if (!anchor || anchor.sessionId !== sessionId) return false;
  for (const turn of turns) {
    for (const entry of [userBoundaryMessage(turn), ...rootMessageEntries(turn)]) {
      if (!entry) continue;
      const exact = anchor.messageId && entry.msg.id === anchor.messageId;
      const indexed = entry.msg.historyIndex === anchor.historyIndex;
      if ((exact || indexed) && entry.msg.timestamp > completedAt) return true;
    }
  }
  return false;
}

export function placeQuestOutcomeInFeed(input: {
  sections: FeedSection[];
  anchor?: QuestOutcomeAnchor;
  sessionId: string;
  hasNewerItems: boolean;
  completedAt?: number;
}): QuestOutcomeFeedPlacement {
  const turns = input.sections.flatMap((section) => section.turns);
  const empty = { coveredTurnIds: new Set<string>(), newerTurnIds: new Set<string>() };
  if (turns.length === 0)
    return input.hasNewerItems ? { kind: "hidden", ...empty } : { kind: "after-window", ...empty };

  // A completed Outcome covers the quest conversation through final reporting,
  // while a later direct-user turn starts visible clarification activity below it.
  if (
    typeof input.completedAt === "number" &&
    !anchorIsPostCompletion(turns, input.anchor, input.sessionId, input.completedAt)
  ) {
    const followupTurnIndex = turns.findIndex((turn) => isDirectPostCompletionUserTurn(turn, input.completedAt!));
    if (followupTurnIndex >= 0) return placementAtSplit(turns, followupTurnIndex);
    return input.hasNewerItems ? { kind: "hidden", ...empty } : placementAtSplit(turns, turns.length);
  }

  // An unanchored first draft covers no chronological activity. Keeping it at
  // the top is stable; later messages remain visibly newer until an explicit advance.
  if (!input.anchor) return placementAtSplit(turns, 0);
  if (input.anchor.sessionId !== input.sessionId) return { kind: "hidden", ...empty };

  if (input.anchor.messageId) {
    const exactUserTurnIndex = turns.findIndex((turn) => userBoundaryMessage(turn)?.msg.id === input.anchor?.messageId);
    if (exactUserTurnIndex >= 0) return placementAfterUser(turns, exactUserTurnIndex);
    const exactTurnIndex = turns.findIndex((turn) =>
      rootMessageEntries(turn).some((entry) => entry.msg.id === input.anchor?.messageId),
    );
    if (exactTurnIndex >= 0) {
      const entries = presentationEntries(turns[exactTurnIndex]!);
      const exactEntryIndex = entries.findIndex(
        (entry) => entry.kind === "message" && entry.msg.id === input.anchor?.messageId,
      );
      if (exactEntryIndex >= 0 && exactEntryIndex < entries.length - 1) {
        return placementWithinTurn(turns, exactTurnIndex, input.anchor.messageId);
      }
      return placementAtSplit(turns, exactTurnIndex + 1);
    }
  }

  const indexedTurns = turns.flatMap((turn, turnIndex) => {
    const indexes = turnHistoryIndexes(turn);
    return indexes.length > 0 ? [{ turnIndex, min: Math.min(...indexes), max: Math.max(...indexes) }] : [];
  });
  if (indexedTurns.length === 0) return { kind: "hidden", ...empty };
  const first = indexedTurns[0]!;
  const last = indexedTurns.at(-1)!;
  if (input.anchor.historyIndex < first.min) return placementAtSplit(turns, 0);
  if (input.anchor.historyIndex > last.max) {
    return input.hasNewerItems ? { kind: "hidden", ...empty } : placementAtSplit(turns, turns.length);
  }

  const containing = indexedTurns.find(
    (entry) => input.anchor!.historyIndex >= entry.min && input.anchor!.historyIndex < entry.max,
  );
  if (containing) {
    const turn = turns[containing.turnIndex]!;
    const userBoundary = userBoundaryMessage(turn);
    if (
      userBoundary &&
      typeof userBoundary.msg.historyIndex === "number" &&
      userBoundary.msg.historyIndex <= input.anchor.historyIndex &&
      rootMessageEntries(turn).every(
        (entry) => (entry.msg.historyIndex ?? Number.MAX_SAFE_INTEGER) > input.anchor!.historyIndex,
      )
    ) {
      return placementAfterUser(turns, containing.turnIndex);
    }
    const messages = rootMessageEntries(turn);
    const prior = messages
      .filter((entry) => (entry.msg.historyIndex ?? Number.MAX_SAFE_INTEGER) <= input.anchor!.historyIndex)
      .at(-1);
    if (prior) return placementWithinTurn(turns, containing.turnIndex, prior.msg.id);
    return placementAtSplit(turns, containing.turnIndex);
  }

  const firstLater = indexedTurns.find((entry) => entry.min > input.anchor!.historyIndex);
  return placementAtSplit(turns, firstLater?.turnIndex ?? turns.length);
}
