import type { BrowserIncomingMessage } from "./session-types.js";
import { JsonRpcTransport } from "./codex-jsonrpc-transport.js";

export type CodexNativeSubagentThreadStatus =
  | { type: "notLoaded" | "idle" | "systemError" }
  | { type: "active"; activeFlags: string[] };

export type CodexNativeSubagentAdapterEvent =
  | {
      type: "owned_message";
      message: BrowserIncomingMessage;
      source: CodexNativeSubagentMessageSource;
    }
  | {
      type: "activity";
      eventId: string;
      senderProviderThreadId: string;
      senderProviderTurnId: string;
      childProviderThreadId: string;
      agentPath: string;
      kind: "started" | "interacted" | "interrupted";
      observedAt: number;
    }
  | {
      type: "thread_metadata";
      childProviderThreadId: string;
      parentProviderThreadId: string;
      agentPath?: string;
      nickname?: string;
      role?: string;
      depth: number;
      createdAt?: number;
      updatedAt?: number;
      status?: CodexNativeSubagentThreadStatus;
      /** Active root turn observed when this root-owned child thread started. */
      rootProviderTurnId?: string;
      observedAt: number;
    }
  | {
      type: "thread_status";
      childProviderThreadId: string;
      status: CodexNativeSubagentThreadStatus;
      observedAt: number;
    }
  | {
      type: "turn_started";
      childProviderThreadId: string;
      childProviderTurnId: string;
      startedAt?: number;
      observedAt: number;
    }
  | {
      type: "turn_completed";
      childProviderThreadId: string;
      childProviderTurnId: string;
      status: "completed" | "failed" | "interrupted" | "inProgress";
      startedAt?: number;
      completedAt?: number;
      observedAt: number;
    }
  | {
      type: "child_error";
      childProviderThreadId: string;
      childProviderTurnId?: string;
      observedAt: number;
    }
  | {
      type: "thread_unavailable";
      childProviderThreadId: string;
      observedAt: number;
    }
  | {
      type: "discovery_finished";
      coverage: "complete" | "partial";
      observedAt: number;
      reason?: "unsupported" | "failed" | "truncated";
    };

export interface CodexNativeSubagentMessageSource {
  providerThreadId: string;
  providerTurnId: string;
  observedAt: number;
  itemId?: string;
}

export type CodexNativeSubagentAdapterEventListener = (event: CodexNativeSubagentAdapterEvent) => void;

export interface CodexNativeSubagentNotificationDisposition {
  suppressDefault: boolean;
  finishReasoningTurnId?: string;
}

export interface CodexNativeSubagentHistoryProviderPage {
  data: unknown[];
  nextCursor: string | null;
}

const DISCOVERY_PAGE_LIMIT = 100;
const DISCOVERY_MAX_PAGES = 2;
const HISTORY_PAGE_LIMIT = 20;
const HISTORY_MAX_PAGE_LIMIT = 50;
const RPC_TIMEOUT_MS = 15_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function providerTimestampMs(params: Record<string, unknown>, method: string): number {
  const direct =
    method === "item/started"
      ? numberValue(params.startedAtMs)
      : method === "item/completed"
        ? numberValue(params.completedAtMs)
        : undefined;
  if (direct !== undefined) return direct;
  const turn = asRecord(params.turn);
  const seconds = numberValue(turn?.completedAt ?? turn?.startedAt);
  return seconds !== undefined ? seconds * 1000 : Date.now();
}

export function getCodexThreadIdFromParams(params: Record<string, unknown>): string | null {
  for (const record of [params, asRecord(params.item), asRecord(params.turn), asRecord(params.msg)]) {
    if (!record) continue;
    const value = stringValue(
      record.threadId ??
        record.senderThreadId ??
        record.conversationId ??
        record.conversation_id ??
        record.new_thread_id,
    );
    if (value) return value;
  }
  return null;
}

function getTurnId(params: Record<string, unknown>): string | null {
  const turn = asRecord(params.turn);
  return stringValue(params.turnId ?? turn?.id);
}

function normalizeThreadStatus(value: unknown): CodexNativeSubagentThreadStatus | null {
  const status = asRecord(value);
  const type = stringValue(status?.type);
  if (type === "notLoaded" || type === "idle" || type === "systemError") return { type };
  if (type !== "active") return null;
  const activeFlags = Array.isArray(status?.activeFlags)
    ? status.activeFlags.filter((flag): flag is string => typeof flag === "string")
    : [];
  return { type: "active", activeFlags };
}

function extractThreadSpawnMetadata(
  value: unknown,
): Omit<Extract<CodexNativeSubagentAdapterEvent, { type: "thread_metadata" }>, "type" | "observedAt"> | null {
  const thread = asRecord(value);
  if (!thread) return null;
  const childProviderThreadId = stringValue(thread.id);
  const parentProviderThreadId = stringValue(thread.parentThreadId);
  const source = asRecord(thread.source);
  const subAgent = asRecord(source?.subAgent);
  const spawn = asRecord(subAgent?.thread_spawn);
  const sourceParent = stringValue(spawn?.parent_thread_id);
  if (!childProviderThreadId || !parentProviderThreadId || !spawn || sourceParent !== parentProviderThreadId)
    return null;

  const createdAt = numberValue(thread.createdAt);
  const updatedAt = numberValue(thread.updatedAt);
  const metadata: Omit<Extract<CodexNativeSubagentAdapterEvent, { type: "thread_metadata" }>, "type" | "observedAt"> = {
    childProviderThreadId,
    parentProviderThreadId,
    depth: Math.max(1, Math.trunc(numberValue(spawn.depth) ?? 1)),
    ...(stringValue(spawn.agent_path) ? { agentPath: stringValue(spawn.agent_path)! } : {}),
    ...(stringValue(spawn.agent_nickname ?? thread.agentNickname)
      ? { nickname: stringValue(spawn.agent_nickname ?? thread.agentNickname)! }
      : {}),
    ...(stringValue(spawn.agent_role ?? thread.agentRole)
      ? { role: stringValue(spawn.agent_role ?? thread.agentRole)! }
      : {}),
    ...(createdAt !== undefined ? { createdAt: createdAt * 1000 } : {}),
    ...(updatedAt !== undefined ? { updatedAt: updatedAt * 1000 } : {}),
  };
  const status = normalizeThreadStatus(thread.status);
  if (status) metadata.status = status;
  return metadata;
}

function isLikelyUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /method not found|not supported|unsupported|invalid params|unknown field/i.test(message);
}

function parseExperimentalPage(value: unknown, method: string): CodexNativeSubagentHistoryProviderPage {
  const response = asRecord(value);
  if (!response || !Array.isArray(response.data)) {
    throw new Error(`Malformed ${method} response: data must be an array`);
  }
  const rawCursor = response.nextCursor;
  let nextCursor: string | null = null;
  if (rawCursor !== undefined && rawCursor !== null) {
    nextCursor = stringValue(rawCursor);
    if (!nextCursor) throw new Error(`Malformed ${method} response: nextCursor must be a non-empty string or null`);
  }
  return { data: response.data, nextCursor };
}

export class CodexNativeSubagentAdapterController {
  private rootProviderThreadId: string | null = null;
  private knownChildProviderThreadIds = new Set<string>();
  private listener: CodexNativeSubagentAdapterEventListener | null = null;
  private currentMessageSource: CodexNativeSubagentMessageSource | null = null;
  private discoveryPending = false;
  private discoveryInFlight = false;
  private discoveryCompleted = false;

  constructor(
    private readonly transport: JsonRpcTransport,
    private readonly isIdle: () => boolean,
    private readonly getActiveRootProviderTurnId: () => string | null = () => null,
  ) {}

  onEvent(listener: CodexNativeSubagentAdapterEventListener): void {
    this.listener = listener;
  }

  setRootProviderThreadId(threadId: string): void {
    this.rootProviderThreadId = threadId;
  }

  seedKnownChildProviderThreadIds(threadIds: Iterable<string>): void {
    for (const threadId of threadIds) {
      if (threadId) this.knownChildProviderThreadIds.add(threadId);
    }
  }

  getCurrentMessageSource(): CodexNativeSubagentMessageSource | null {
    return this.currentMessageSource;
  }

  isKnownChildProviderThreadId(threadId: string): boolean {
    return this.knownChildProviderThreadIds.has(threadId);
  }

  emitOwnedBrowserMessage(message: BrowserIncomingMessage, source: CodexNativeSubagentMessageSource): boolean {
    if (!this.isKnownChildProviderThreadId(source.providerThreadId)) return false;
    if (
      message.type !== "assistant" &&
      message.type !== "stream_event" &&
      message.type !== "tool_progress" &&
      message.type !== "codex_reasoning_detail"
    ) {
      return true;
    }
    this.emit({ type: "owned_message", message, source });
    return true;
  }

  observeNotification(method: string, params: Record<string, unknown>): CodexNativeSubagentNotificationDisposition {
    const providerThreadId = getCodexThreadIdFromParams(params);
    const providerTurnId = getTurnId(params);
    // Terminal receipt order must beat earlier activity/error evidence. Other
    // notifications retain provider timestamps for stable replay recency.
    const observedAt = method === "turn/completed" ? Date.now() : providerTimestampMs(params, method);
    const item = asRecord(params.item);
    const itemId = stringValue(item?.id ?? params.itemId) ?? undefined;
    this.currentMessageSource =
      providerThreadId && providerTurnId
        ? {
            providerThreadId,
            providerTurnId,
            observedAt,
            ...(itemId ? { itemId } : {}),
          }
        : null;

    if ((method === "item/started" || method === "item/completed") && item?.type === "subAgentActivity") {
      const childProviderThreadId = stringValue(item.agentThreadId);
      const senderProviderThreadId = providerThreadId;
      const senderProviderTurnId = providerTurnId;
      const eventId = stringValue(item.id);
      const agentPath = stringValue(item.agentPath);
      const kind = stringValue(item.kind);
      if (
        childProviderThreadId &&
        senderProviderThreadId &&
        senderProviderTurnId &&
        eventId &&
        agentPath &&
        (kind === "started" || kind === "interacted" || kind === "interrupted")
      ) {
        this.knownChildProviderThreadIds.add(childProviderThreadId);
        this.emit({
          type: "activity",
          eventId,
          senderProviderThreadId,
          senderProviderTurnId,
          childProviderThreadId,
          agentPath,
          kind,
          observedAt,
        });
      }
    }

    if (method === "thread/started") {
      const metadata = extractThreadSpawnMetadata(params.thread);
      if (metadata) {
        this.knownChildProviderThreadIds.add(metadata.childProviderThreadId);
        const rootProviderTurnId =
          metadata.parentProviderThreadId === this.rootProviderThreadId ? this.getActiveRootProviderTurnId() : null;
        this.emit({
          type: "thread_metadata",
          ...metadata,
          ...(rootProviderTurnId ? { rootProviderTurnId } : {}),
          observedAt,
        });
      }
      return { suppressDefault: false };
    }

    const isChild = !!providerThreadId && this.knownChildProviderThreadIds.has(providerThreadId);
    if (!isChild || !providerThreadId) return { suppressDefault: false };

    if (method === "thread/status/changed") {
      const status = normalizeThreadStatus(params.status);
      if (status)
        this.emit({
          type: "thread_status",
          childProviderThreadId: providerThreadId,
          status,
          observedAt,
        });
      return { suppressDefault: true };
    }

    if (method === "turn/started" && providerTurnId) {
      const turn = asRecord(params.turn);
      const startedAt = numberValue(turn?.startedAt);
      this.emit({
        type: "turn_started",
        childProviderThreadId: providerThreadId,
        childProviderTurnId: providerTurnId,
        ...(startedAt !== undefined ? { startedAt: startedAt * 1000 } : {}),
        observedAt,
      });
      return { suppressDefault: true };
    }

    if (method === "turn/completed" && providerTurnId) {
      const turn = asRecord(params.turn);
      const status = stringValue(turn?.status);
      if (status === "completed" || status === "failed" || status === "interrupted" || status === "inProgress") {
        const startedAt = numberValue(turn?.startedAt);
        const completedAt = numberValue(turn?.completedAt);
        this.emit({
          type: "turn_completed",
          childProviderThreadId: providerThreadId,
          childProviderTurnId: providerTurnId,
          status,
          ...(startedAt !== undefined ? { startedAt: startedAt * 1000 } : {}),
          ...(completedAt !== undefined ? { completedAt: completedAt * 1000 } : {}),
          observedAt,
        });
      }
      return { suppressDefault: true, finishReasoningTurnId: providerTurnId };
    }

    if (method === "error" || method === "codex/event/error" || method === "codex/event/stream_error") {
      this.emit({
        type: "child_error",
        childProviderThreadId: providerThreadId,
        ...(providerTurnId ? { childProviderTurnId: providerTurnId } : {}),
        observedAt,
      });
      return { suppressDefault: true };
    }

    if (
      method === "thread/closed" ||
      method === "thread/archived" ||
      method === "thread/unarchived" ||
      method === "thread/deleted"
    ) {
      this.emit({
        type: "thread_unavailable",
        childProviderThreadId: providerThreadId,
        observedAt,
      });
      return { suppressDefault: true };
    }

    return { suppressDefault: false };
  }

  clearNotificationContext(): void {
    this.currentMessageSource = null;
  }

  requestDiscovery(): void {
    if (this.discoveryCompleted || this.discoveryInFlight) return;
    this.discoveryPending = true;
    queueMicrotask(() => void this.drainDiscovery());
  }

  drainDiscovery(): void {
    if (!this.discoveryPending || this.discoveryInFlight || !this.isIdle()) return;
    this.discoveryPending = false;
    this.discoveryInFlight = true;
    void this.discover().finally(() => {
      this.discoveryInFlight = false;
    });
  }

  async listTurns(
    providerThreadId: string,
    options: {
      cursor?: string | null;
      limit?: number;
      itemsView?: "notLoaded" | "summary" | "full";
    } = {},
  ): Promise<CodexNativeSubagentHistoryProviderPage> {
    const limit = Math.max(1, Math.min(HISTORY_MAX_PAGE_LIMIT, Math.trunc(options.limit ?? HISTORY_PAGE_LIMIT)));
    const page = parseExperimentalPage(
      await this.transport.call(
        "thread/turns/list",
        {
          threadId: providerThreadId,
          limit,
          sortDirection: "desc",
          itemsView: options.itemsView ?? "full",
          ...(options.cursor ? { cursor: options.cursor } : {}),
        },
        RPC_TIMEOUT_MS,
      ),
      "thread/turns/list",
    );
    for (const turn of page.data) {
      if (!stringValue(asRecord(turn)?.id)) {
        throw new Error("Malformed thread/turns/list response: every turn must have a non-empty id");
      }
    }
    return page;
  }

  private async discover(): Promise<void> {
    const rootProviderThreadId = this.rootProviderThreadId;
    if (!rootProviderThreadId) {
      this.discoveryPending = true;
      return;
    }

    let cursor: string | null = null;
    let pages = 0;
    try {
      do {
        const page = parseExperimentalPage(
          await this.transport.call(
            "thread/list",
            {
              ancestorThreadId: rootProviderThreadId,
              sourceKinds: ["subAgentThreadSpawn"],
              archived: false,
              sortKey: "created_at",
              sortDirection: "asc",
              limit: DISCOVERY_PAGE_LIMIT,
              ...(cursor ? { cursor } : {}),
            },
            RPC_TIMEOUT_MS,
          ),
          "thread/list",
        );
        for (const thread of page.data) {
          const metadata = extractThreadSpawnMetadata(thread);
          if (!metadata) {
            throw new Error("Malformed thread/list response: descendant row lacks a verified thread_spawn source");
          }
          this.knownChildProviderThreadIds.add(metadata.childProviderThreadId);
          this.emit({
            type: "thread_metadata",
            ...metadata,
            observedAt: Date.now(),
          });
        }
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < DISCOVERY_MAX_PAGES);

      const coverage = cursor ? "partial" : "complete";
      this.discoveryCompleted = !cursor;
      this.emit({
        type: "discovery_finished",
        coverage,
        observedAt: Date.now(),
        ...(cursor ? { reason: "truncated" as const } : {}),
      });
    } catch (error) {
      this.emit({
        type: "discovery_finished",
        coverage: "partial",
        observedAt: Date.now(),
        reason: isLikelyUnsupported(error) ? "unsupported" : "failed",
      });
    }
  }

  private emit(event: CodexNativeSubagentAdapterEvent): void {
    this.listener?.(event);
  }
}
