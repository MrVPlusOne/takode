import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import { refreshBrowserConversationViews } from "./browser-transport-controller.js";
import { toPublicCodexNativeSubagentOwnership } from "../../shared/codex-native-subagent-types.js";
import type {
  CodexNativeSubagentAdapterEvent,
  CodexNativeSubagentMessageSource,
} from "../codex-native-subagent-adapter-controller.js";
import {
  applyCodexNativeSubagentEvent,
  collectCodexNativeSubagentProviderSensitiveIds,
  createCodexNativeSubagentRegistry,
  deriveCodexNativeSubagentSnapshot,
  seedCodexNativeSubagentAdapterContext,
  setCodexNativeSubagentCoverage,
  type CodexNativeSubagentProviderEvent,
  type CodexNativeSubagentRegistry,
} from "../codex-native-subagent-state.js";
import {
  projectCodexNativeSubagentInspectorMessages,
  sanitizeCodexNativeSubagentAuditText,
} from "../codex-native-subagent-history.js";
import { canonicalizeCodexNativeSubagentOwnership } from "../codex-native-subagent-ownership-repair.js";

export interface CodexNativeSubagentLifecycleSessionLike {
  id: string;
  state: {
    codex_native_subagents?: ReturnType<typeof deriveCodexNativeSubagentSnapshot>;
  };
  codexAdapter: unknown;
  codexNativeSubagents?: CodexNativeSubagentRegistry;
  pendingCodexTurns: CodexOutboundTurn[];
  messageHistory: BrowserIncomingMessage[];
  browserSockets: Set<unknown>;
  nextEventSeq: number;
  frozenCount: number;
  eventBuffer?: Array<{ message: BrowserIncomingMessage }>;
}

export interface CodexNativeSubagentLifecycleAdapterLike {
  getNativeSubagentController?: () => {
    onEvent: (listener: (event: CodexNativeSubagentAdapterEvent) => void) => void;
    seedKnownChildProviderThreadIds: (threadIds: Iterable<string>) => void;
  };
}

export interface CodexNativeSubagentLifecycleDeps {
  persistSession: (session: CodexNativeSubagentLifecycleSessionLike) => void;
  persistHistoryOwnershipRepair?: (
    session: CodexNativeSubagentLifecycleSessionLike,
    expectedFrozenCount: number,
  ) => Promise<void>;
  broadcastToBrowsers: (session: CodexNativeSubagentLifecycleSessionLike, message: BrowserIncomingMessage) => void;
  handleOwnedBrowserMessage: (
    session: CodexNativeSubagentLifecycleSessionLike,
    message: BrowserIncomingMessage,
  ) => Promise<void> | void;
}

function findFeedTurnKey(
  session: CodexNativeSubagentLifecycleSessionLike,
  providerTurnId: string,
  observedAt: number,
): string | undefined {
  const candidates = session.pendingCodexTurns
    .filter((turn) => turn.turnId === providerTurnId)
    .filter((turn) => (turn.acknowledgedAt ?? turn.createdAt) <= observedAt)
    .sort(
      (left, right) =>
        (right.acknowledgedAt ?? right.createdAt) - (left.acknowledgedAt ?? left.createdAt) ||
        right.createdAt - left.createdAt,
    );
  const pendingOwner = candidates[0]?.userMessageId;
  if (pendingOwner) return pendingOwner;

  let latestUserMessageId: string | undefined;
  let matchedUserMessageId: string | undefined;
  for (const message of session.messageHistory) {
    if (message.type === "user_message" && typeof message.id === "string") {
      latestUserMessageId = message.id;
      continue;
    }
    if (message.type !== "result" || message.data.codex_turn_id !== providerTurnId) continue;
    matchedUserMessageId = latestUserMessageId;
  }
  return matchedUserMessageId;
}

function toStateEvent(
  registry: CodexNativeSubagentRegistry,
  event: Exclude<CodexNativeSubagentAdapterEvent, { type: "owned_message" }>,
): CodexNativeSubagentProviderEvent | null {
  switch (event.type) {
    case "root_thread_identified":
      return {
        type: "root_thread_identified",
        providerThreadId: event.providerThreadId,
        observedAt: event.observedAt,
      };
    case "activity": {
      const nestedParent =
        event.kind === "started" ? registry.childrenByProviderThreadId[event.senderProviderThreadId] : undefined;
      return {
        type: "activity",
        kind: event.kind,
        providerThreadId: event.childProviderThreadId,
        ...(event.kind === "started" ? { providerParentThreadId: event.senderProviderThreadId } : {}),
        providerEventId: event.eventId,
        ...(event.kind === "started" && !nestedParent ? { rootProviderTurnId: event.senderProviderTurnId } : {}),
        agentPath: event.agentPath,
        observedAt: event.observedAt,
        ...(event.kind === "started" ? { startedAt: event.observedAt } : {}),
      };
    }
    case "thread_metadata":
      return {
        type: "thread_metadata",
        thread: {
          id: event.childProviderThreadId,
          parentThreadId: event.parentProviderThreadId,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          status: event.status,
          agentNickname: event.nickname,
          agentRole: event.role,
          nickname: event.nickname,
          role: event.role,
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: event.parentProviderThreadId,
                depth: event.depth,
                agent_path: event.agentPath,
                agent_nickname: event.nickname,
                agent_role: event.role,
                nickname: event.nickname,
                role: event.role,
              },
            },
          },
        },
        ...(event.rootProviderTurnId ? { rootProviderTurnId: event.rootProviderTurnId } : {}),
        observedAt: event.observedAt,
      };
    case "thread_status":
      return {
        type: "thread_status",
        providerThreadId: event.childProviderThreadId,
        status: event.status,
        observedAt: event.observedAt,
      };
    case "turn_started":
      return {
        type: "turn_started",
        providerThreadId: event.childProviderThreadId,
        providerTurnId: event.childProviderTurnId,
        startedAt: event.startedAt,
        observedAt: event.observedAt,
      };
    case "turn_completed":
      return {
        type: "turn_completed",
        providerThreadId: event.childProviderThreadId,
        providerTurnId: event.childProviderTurnId,
        status: event.status,
        startedAt: event.startedAt,
        completedAt: event.completedAt,
        observedAt: event.observedAt,
      };
    case "child_error":
      return {
        type: "child_error",
        providerThreadId: event.childProviderThreadId,
        ...(event.childProviderTurnId ? { providerTurnId: event.childProviderTurnId } : {}),
        observedAt: event.observedAt,
      };
    case "thread_unavailable":
      return {
        type: "thread_status",
        providerThreadId: event.childProviderThreadId,
        status: "closed",
        observedAt: event.observedAt,
      };
    case "discovery_finished":
      return {
        type: event.coverage === "complete" ? "discovery_complete" : "discovery_partial",
        observedAt: event.observedAt,
      };
  }
}

function publishSnapshot(
  session: CodexNativeSubagentLifecycleSessionLike,
  deps: CodexNativeSubagentLifecycleDeps,
): void {
  const registry = session.codexNativeSubagents;
  if (!registry) return;
  const snapshot = deriveCodexNativeSubagentSnapshot(registry);
  session.state.codex_native_subagents = snapshot;
  deps.persistSession(session);
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { codex_native_subagents: snapshot },
  });
}

function repairHistoryOwnership(
  session: CodexNativeSubagentLifecycleSessionLike,
  registry: CodexNativeSubagentRegistry,
  removedChildIds: string[],
  forceAudit: boolean,
): boolean {
  if (removedChildIds.length === 0 && !forceAudit) return false;
  return canonicalizeCodexNativeSubagentOwnership(
    registry,
    session.messageHistory,
    session.eventBuffer,
    removedChildIds,
  );
}

function persistOwnershipRepair(
  session: CodexNativeSubagentLifecycleSessionLike,
  deps: CodexNativeSubagentLifecycleDeps,
): void {
  const expectedFrozenCount = Math.max(0, Math.min(session.frozenCount, session.messageHistory.length));
  if (!deps.persistHistoryOwnershipRepair) {
    deps.persistSession(session);
    return;
  }
  void deps.persistHistoryOwnershipRepair(session, expectedFrozenCount).catch((error) => {
    console.error(`[codex-native-subagents] Failed to persist history ownership repair for ${session.id}:`, error);
    deps.persistSession(session);
  });
}

function applyEvent(
  session: CodexNativeSubagentLifecycleSessionLike,
  event: CodexNativeSubagentProviderEvent,
  observedAt: number,
  deps: CodexNativeSubagentLifecycleDeps,
): boolean {
  const registry = session.codexNativeSubagents;
  if (!registry) return false;
  const result = applyCodexNativeSubagentEvent(registry, event, {
    resolveFeedRootTurnKey: (providerTurnId) => findFeedTurnKey(session, providerTurnId, observedAt),
    now: observedAt,
  });
  const historyChanged = repairHistoryOwnership(
    session,
    registry,
    result.removedChildIds ?? [],
    event.type === "root_thread_identified",
  );
  if (result.changed || historyChanged) {
    const snapshot = deriveCodexNativeSubagentSnapshot(registry);
    session.state.codex_native_subagents = snapshot;
    if (historyChanged) persistOwnershipRepair(session, deps);
    else deps.persistSession(session);
    deps.broadcastToBrowsers(session, {
      type: "session_update",
      session: { codex_native_subagents: snapshot },
    });
  }
  if (historyChanged) {
    refreshBrowserConversationViews(session);
  }
  return result.changed || historyChanged;
}

function ownershipForSource(registry: CodexNativeSubagentRegistry, source: CodexNativeSubagentMessageSource) {
  const ownership = seedCodexNativeSubagentAdapterContext(registry).get(source.providerThreadId);
  return ownership ? toPublicCodexNativeSubagentOwnership(ownership) : undefined;
}

export function registerCodexNativeSubagentLifecycle(
  session: CodexNativeSubagentLifecycleSessionLike,
  adapter: CodexNativeSubagentLifecycleAdapterLike,
  deps: CodexNativeSubagentLifecycleDeps,
): void {
  const controller = adapter.getNativeSubagentController?.();
  if (!controller) return;

  const registry =
    session.codexNativeSubagents ?? (session.codexNativeSubagents = createCodexNativeSubagentRegistry(session.id));
  if (setCodexNativeSubagentCoverage(registry, "partial")) {
    publishSnapshot(session, deps);
  } else {
    session.state.codex_native_subagents = deriveCodexNativeSubagentSnapshot(registry);
  }
  controller.seedKnownChildProviderThreadIds(seedCodexNativeSubagentAdapterContext(registry).keys());

  const pendingOwnedMessages = new Map<
    string,
    Array<Extract<CodexNativeSubagentAdapterEvent, { type: "owned_message" }>>
  >();
  const MAX_PENDING_OWNED_MESSAGES_PER_CHILD = 100;

  const deliverOwnedMessage = (event: Extract<CodexNativeSubagentAdapterEvent, { type: "owned_message" }>): boolean => {
    const ownership = ownershipForSource(registry, event.source);
    if (!ownership) return false;
    applyEvent(
      session,
      {
        type: "owned_message_observed",
        providerThreadId: event.source.providerThreadId,
        providerMessageId:
          event.message.type === "assistant"
            ? (event.message.message.id ?? event.message.uuid)
            : event.message.type === "codex_reasoning_detail"
              ? event.message.id
              : undefined,
        transcriptAvailability: "partial",
        observedAt: event.source.observedAt,
      },
      event.source.observedAt,
      deps,
    );
    const sensitiveStrings = [
      ...collectCodexNativeSubagentProviderSensitiveIds(registry),
      event.source.providerThreadId,
      ...(event.source.providerTurnId ? [event.source.providerTurnId] : []),
      ...(event.source.itemId ? [event.source.itemId] : []),
    ];
    const sourceMessage =
      event.message.type === "error"
        ? {
            ...event.message,
            message:
              sanitizeCodexNativeSubagentAuditText(event.message.message, sensitiveStrings) ||
              "Child agent reported an error.",
          }
        : event.message;
    const ownedMessage = {
      ...sourceMessage,
      codexSubagent: ownership,
    } as BrowserIncomingMessage;
    const projectedMessages =
      ownedMessage.type === "assistant" || ownedMessage.type === "codex_reasoning_detail"
        ? projectCodexNativeSubagentInspectorMessages([ownedMessage], { ownership, sensitiveStrings })
        : ownedMessage.type === "error"
          ? [ownedMessage]
          : [];
    // Streaming/progress packets are root-state inputs in the normal feed and
    // have no child-owned browser surface. Keep the final bounded assistant,
    // reasoning, tool, result, and error audit rows instead of exposing raw IDs.
    for (const projectedMessage of projectedMessages) {
      void deps.handleOwnedBrowserMessage(session, projectedMessage);
    }
    return true;
  };

  const flushPendingOwnedMessages = (providerThreadId: string): void => {
    const pending = pendingOwnedMessages.get(providerThreadId);
    if (!pending?.length) return;
    if (!ownershipForSource(registry, pending[0]!.source)) return;
    pendingOwnedMessages.delete(providerThreadId);
    for (const event of pending) deliverOwnedMessage(event);
  };

  controller.onEvent((event) => {
    if (session.codexAdapter !== adapter) return;
    if (event.type === "owned_message") {
      if (deliverOwnedMessage(event)) return;
      const pending = pendingOwnedMessages.get(event.source.providerThreadId) ?? [];
      pending.push(event);
      if (pending.length > MAX_PENDING_OWNED_MESSAGES_PER_CHILD) pending.shift();
      pendingOwnedMessages.set(event.source.providerThreadId, pending);
      return;
    }

    if (event.type === "root_thread_identified") {
      pendingOwnedMessages.delete(event.providerThreadId);
    }
    const stateEvent = toStateEvent(registry, event);
    if (stateEvent) applyEvent(session, stateEvent, event.observedAt ?? Date.now(), deps);
    if (event.type === "root_thread_identified") {
      controller.seedKnownChildProviderThreadIds(seedCodexNativeSubagentAdapterContext(registry).keys());
      for (const providerThreadId of [...pendingOwnedMessages.keys()]) flushPendingOwnedMessages(providerThreadId);
    } else if ("childProviderThreadId" in event) {
      flushPendingOwnedMessages(event.childProviderThreadId);
    }
  });
}
