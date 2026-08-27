import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import { toPublicCodexNativeSubagentOwnership } from "../../shared/codex-native-subagent-types.js";
import type {
  CodexNativeSubagentAdapterEvent,
  CodexNativeSubagentMessageSource,
} from "../codex-native-subagent-adapter-controller.js";
import {
  applyCodexNativeSubagentEvent,
  createCodexNativeSubagentRegistry,
  deriveCodexNativeSubagentSnapshot,
  seedCodexNativeSubagentAdapterContext,
  setCodexNativeSubagentCoverage,
  type CodexNativeSubagentProviderEvent,
  type CodexNativeSubagentRegistry,
} from "../codex-native-subagent-state.js";

export interface CodexNativeSubagentLifecycleSessionLike {
  id: string;
  state: {
    codex_native_subagents?: ReturnType<typeof deriveCodexNativeSubagentSnapshot>;
  };
  codexAdapter: unknown;
  codexNativeSubagents?: CodexNativeSubagentRegistry;
  pendingCodexTurns: CodexOutboundTurn[];
  messageHistory: BrowserIncomingMessage[];
}

export interface CodexNativeSubagentLifecycleAdapterLike {
  getNativeSubagentController?: () => {
    onEvent: (listener: (event: CodexNativeSubagentAdapterEvent) => void) => void;
    seedKnownChildProviderThreadIds: (threadIds: Iterable<string>) => void;
  };
}

export interface CodexNativeSubagentLifecycleDeps {
  persistSession: (session: CodexNativeSubagentLifecycleSessionLike) => void;
  handleBrowserMessage: (
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
    case "activity": {
      const nestedParent = registry.childrenByProviderThreadId[event.senderProviderThreadId];
      return {
        type: "activity",
        kind: event.kind,
        providerThreadId: event.childProviderThreadId,
        ...(nestedParent ? { providerParentThreadId: event.senderProviderThreadId } : {}),
        providerEventId: event.eventId,
        ...(nestedParent ? {} : { rootProviderTurnId: event.senderProviderTurnId }),
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
  void deps.handleBrowserMessage(session, {
    type: "session_update",
    session: { codex_native_subagents: snapshot },
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
  if (result.changed) publishSnapshot(session, deps);
  return result.changed;
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
  controller.seedKnownChildProviderThreadIds(Object.keys(registry.childrenByProviderThreadId));

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
    const safeMessage = {
      ...event.message,
      codexSubagent: ownership,
    } as BrowserIncomingMessage;
    void deps.handleBrowserMessage(session, safeMessage);
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

    const stateEvent = toStateEvent(registry, event);
    if (stateEvent) applyEvent(session, stateEvent, event.observedAt ?? Date.now(), deps);
    if ("childProviderThreadId" in event) flushPendingOwnedMessages(event.childProviderThreadId);
  });
}
