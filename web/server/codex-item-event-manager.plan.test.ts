import { describe, expect, it, vi } from "vitest";
import {
  handleCodexAdapterBrowserMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./bridge/codex-adapter-browser-message-controller.js";
import { isDuplicateCodexAssistantReplay } from "./bridge/codex-assistant-replay-dedup.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import { CodexItemEventManager } from "./codex-item-event-manager.js";
import type { BrowserIncomingMessage, ContentBlock } from "./session-types.js";

type AssistantMessage = Extract<BrowserIncomingMessage, { type: "assistant" }>;
type PlanStatus = "pending" | "inProgress" | "completed";
type TestCodexSession = {
  id: string;
  state: Record<string, unknown>;
  messageHistory: BrowserIncomingMessage[];
  toolStartTimes: Map<string, number>;
  toolProgressOutput: Map<string, string>;
  isGenerating: boolean;
  activeTurnRoute: null;
  notifications: [];
  notificationCounter: number;
  attentionReason: null;
  lastCliMessageAt?: number;
};

const STEPS = ["Inspect evidence", "Implement repair", "Verify completion"] as const;

function planUpdate(turnId: string, statuses: readonly PlanStatus[]): Record<string, unknown> {
  return {
    turnId,
    plan: STEPS.map((step, index) => ({ step, status: statuses[index] })),
  };
}

function todoWriteMessages(messages: BrowserIncomingMessage[]): AssistantMessage[] {
  return messages.filter((message): message is AssistantMessage => {
    if (message.type !== "assistant") return false;
    return message.message.content.some((block) => block.type === "tool_use" && block.name === "TodoWrite");
  });
}

function todoWriteBlock(message: AssistantMessage): Extract<ContentBlock, { type: "tool_use" }> {
  const block = message.message.content.find(
    (candidate): candidate is Extract<ContentBlock, { type: "tool_use" }> =>
      candidate.type === "tool_use" && candidate.name === "TodoWrite",
  );
  if (!block) throw new Error("Expected a TodoWrite tool_use block");
  return block;
}

function makeSession(): TestCodexSession {
  return {
    id: "plan-reconnect-session",
    state: { backend_type: "codex", isOrchestrator: false },
    messageHistory: [],
    toolStartTimes: new Map(),
    toolProgressOutput: new Map(),
    isGenerating: false,
    activeTurnRoute: null,
    notifications: [],
    notificationCounter: 0,
    attentionReason: null,
  };
}

function makeControllerDeps(
  broadcasts: BrowserIncomingMessage[],
  persistSession: CodexAdapterBrowserMessageDeps["persistSession"],
): CodexAdapterBrowserMessageDeps {
  return {
    getLauncherSessionInfo: () => null,
    touchActivity: vi.fn(),
    clearOptimisticRunningTimer: vi.fn(),
    setCodexImageSendStage: vi.fn(),
    sanitizeCodexSessionPatch: (patch) => patch,
    cacheSlashCommandState: vi.fn(),
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    persistSession,
    emitTakodeEvent: vi.fn(),
    freezeHistoryThroughCurrentTail: vi.fn(),
    injectCompactionRecovery: vi.fn(),
    trackCodexQuestCommands: vi.fn(),
    reconcileCodexQuestToolResult: vi.fn(async () => {}),
    collectCompletedToolStartTimes: () => [],
    buildToolResultPreviews: () => [],
    broadcastToBrowsers: (_session, message) => broadcasts.push(message),
    finalizeSupersededCodexTerminalTools: vi.fn(),
    isDuplicateCodexAssistantReplay: (session, message) =>
      isDuplicateCodexAssistantReplay(session as unknown as Session, message),
    completeCodexTurnsForResult: vi.fn(() => true),
    clearCodexFreshTurnRequirement: vi.fn(),
    handleResultMessage: vi.fn(),
    queueCodexPendingStartBatch: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    handleCodexPermissionRequest: vi.fn(),
    requestCodexLeaderRecycle: vi.fn(async () => ({ ok: true })),
    handleCodexResultErrorAutoPause: vi.fn(),
  };
}

describe("CodexItemEventManager plan identity", () => {
  it("persists and broadcasts changed official plan updates across manager recreation while deduplicating replay", async () => {
    // The app server can replay the latest turn/plan/updated notification after
    // Takode recreates its adapter. The replay must keep the same identity,
    // while later same-turn status transitions need new identities through completion.
    const firstLifetimeMessages: BrowserIncomingMessage[] = [];
    const firstLifetime = new CodexItemEventManager((message) => firstLifetimeMessages.push(message), {
      model: "gpt-5.6-sol",
    });
    const turnId = "turn-plan-reconnect";

    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["inProgress", "pending", "pending"]), "turn_plan_updated");
    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "inProgress", "pending"]), "turn_plan_updated");
    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "inProgress", "pending"]), "turn_plan_updated");
    firstLifetime.dispose();

    const secondLifetimeMessages: BrowserIncomingMessage[] = [];
    const secondLifetime = new CodexItemEventManager((message) => secondLifetimeMessages.push(message), {
      model: "gpt-5.6-sol",
    });
    secondLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "inProgress", "pending"]), "turn_plan_updated");
    secondLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "completed", "inProgress"]), "turn_plan_updated");
    secondLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "completed", "completed"]), "turn_plan_updated");
    secondLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "completed", "completed"]), "turn_plan_updated");

    const firstLifetimePlans = todoWriteMessages(firstLifetimeMessages);
    const secondLifetimePlans = todoWriteMessages(secondLifetimeMessages);
    expect(firstLifetimePlans).toHaveLength(2);
    expect(secondLifetimePlans).toHaveLength(3);

    // Recreation resets the local sequence, so the replay initially collides
    // with the first (different) persisted state rather than its own prior ID.
    expect(todoWriteBlock(secondLifetimePlans[0]!).id).toBe(todoWriteBlock(firstLifetimePlans[0]!).id);
    expect(secondLifetimePlans[0]!.message.id).toBe(firstLifetimePlans[0]!.message.id);

    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const persistSession = vi.fn();
    const deps = makeControllerDeps(broadcasts, persistSession);
    for (const message of [...firstLifetimePlans, ...secondLifetimePlans]) {
      await handleCodexAdapterBrowserMessage(session, message, deps);
    }

    const accepted = todoWriteMessages(session.messageHistory);
    expect(accepted).toHaveLength(4);
    expect(todoWriteMessages(broadcasts)).toEqual(accepted);
    expect(persistSession).toHaveBeenCalledTimes(4);
    expect(new Set(accepted.map((message) => message.message.id)).size).toBe(4);
    expect(new Set(accepted.map((message) => todoWriteBlock(message).id)).size).toBe(4);
    expect(
      accepted.map((message) =>
        (todoWriteBlock(message).input.todos as Array<{ status: string }>).map((todo) => todo.status),
      ),
    ).toEqual([
      ["in_progress", "pending", "pending"],
      ["completed", "in_progress", "pending"],
      ["completed", "completed", "in_progress"],
      ["completed", "completed", "completed"],
    ]);
  });

  it("persists an authoritative empty turn plan after manager recreation", async () => {
    // The recreated manager cannot remember the earlier non-empty signature.
    // A first empty official state must still produce a stable clear event;
    // repeating that state within the new lifetime remains a no-op.
    const firstLifetimeMessages: BrowserIncomingMessage[] = [];
    const firstLifetime = new CodexItemEventManager((message) => firstLifetimeMessages.push(message), {});
    const turnId = "turn-plan-clear-after-reconnect";
    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "inProgress", "pending"]), "turn_plan_updated");
    firstLifetime.dispose();

    const secondLifetimeMessages: BrowserIncomingMessage[] = [];
    const secondLifetime = new CodexItemEventManager((message) => secondLifetimeMessages.push(message), {});
    const clearedPlan = { turnId, plan: [] };
    secondLifetime.emitPlanTodoWrite(clearedPlan, "turn_plan_updated");
    secondLifetime.emitPlanTodoWrite(clearedPlan, "turn_plan_updated");

    const firstPlan = todoWriteMessages(firstLifetimeMessages);
    const clearPlans = todoWriteMessages(secondLifetimeMessages);
    expect(firstPlan).toHaveLength(1);
    expect(clearPlans).toHaveLength(1);
    expect(todoWriteBlock(clearPlans[0]!).input.todos).toEqual([]);

    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const persistSession = vi.fn<(session: unknown) => void>();
    const deps = makeControllerDeps(broadcasts, persistSession);
    await handleCodexAdapterBrowserMessage(session, firstPlan[0]!, deps);
    await handleCodexAdapterBrowserMessage(session, clearPlans[0]!, deps);

    const accepted = todoWriteMessages(session.messageHistory);
    expect(accepted).toHaveLength(2);
    expect(todoWriteMessages(broadcasts)).toEqual(accepted);
    expect(todoWriteBlock(accepted[1]!).input.todos).toEqual([]);
    expect(todoWriteBlock(accepted[1]!).id).toMatch(/-2$/);
  });

  it("assigns a fresh occurrence identity when a prior plan state returns", async () => {
    // Content hashing alone would reuse A's first tool/message IDs in A -> B -> A,
    // causing exact-ID replay dedup to discard the real reversion. Persisted
    // history must rekey the recurrence, then reject its replay after recreation.
    const turnId = "turn-plan-state-recurrence";
    const firstLifetimeMessages: BrowserIncomingMessage[] = [];
    const firstLifetime = new CodexItemEventManager((message) => firstLifetimeMessages.push(message), {});
    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["inProgress", "pending", "pending"]), "turn_plan_updated");
    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "inProgress", "pending"]), "turn_plan_updated");
    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["inProgress", "pending", "pending"]), "turn_plan_updated");
    firstLifetime.dispose();

    const secondLifetimeMessages: BrowserIncomingMessage[] = [];
    const secondLifetime = new CodexItemEventManager((message) => secondLifetimeMessages.push(message), {});
    secondLifetime.emitPlanTodoWrite(planUpdate(turnId, ["inProgress", "pending", "pending"]), "turn_plan_updated");
    secondLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "inProgress", "pending"]), "turn_plan_updated");

    const firstLifetimePlans = todoWriteMessages(firstLifetimeMessages);
    const secondLifetimePlans = todoWriteMessages(secondLifetimeMessages);
    expect(todoWriteBlock(firstLifetimePlans[2]!).id).not.toBe(todoWriteBlock(firstLifetimePlans[0]!).id);

    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const persistSession = vi.fn<(session: unknown) => void>();
    const deps = makeControllerDeps(broadcasts, persistSession);
    for (const message of [...firstLifetimePlans, ...secondLifetimePlans]) {
      await handleCodexAdapterBrowserMessage(session, message, deps);
    }

    const accepted = todoWriteMessages(session.messageHistory);
    expect(accepted).toHaveLength(4);
    expect(todoWriteMessages(broadcasts)).toEqual(accepted);
    expect(persistSession).toHaveBeenCalledTimes(4);
    expect(new Set(accepted.map((message) => todoWriteBlock(message).id)).size).toBe(4);
    expect(todoWriteBlock(accepted[2]!).id).toMatch(/-3$/);
    expect(todoWriteBlock(accepted[3]!).id).toMatch(/-4$/);
  });

  it("rekeys the first changed state after recreation and drops its identical replay", async () => {
    // This is the original failure topology: lifetime one emits only A, then a
    // recreated manager assigns sequence 1 to changed B. The bridge must move B
    // to sequence 2 before generic exact-ID dedup and reject a repeated B.
    const turnId = "turn-plan-first-change-after-reconnect";
    const firstLifetimeMessages: BrowserIncomingMessage[] = [];
    const firstLifetime = new CodexItemEventManager((message) => firstLifetimeMessages.push(message), {});
    firstLifetime.emitPlanTodoWrite(planUpdate(turnId, ["inProgress", "pending", "pending"]), "turn_plan_updated");
    firstLifetime.dispose();

    const secondLifetimeMessages: BrowserIncomingMessage[] = [];
    const secondLifetime = new CodexItemEventManager((message) => secondLifetimeMessages.push(message), {});
    secondLifetime.emitPlanTodoWrite(planUpdate(turnId, ["completed", "inProgress", "pending"]), "turn_plan_updated");

    const firstPlan = todoWriteMessages(firstLifetimeMessages)[0]!;
    const changedPlan = todoWriteMessages(secondLifetimeMessages)[0]!;
    expect(todoWriteBlock(changedPlan).id).toBe(todoWriteBlock(firstPlan).id);

    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const persistSession = vi.fn<(session: unknown) => void>();
    const deps = makeControllerDeps(broadcasts, persistSession);
    await handleCodexAdapterBrowserMessage(session, firstPlan, deps);
    await handleCodexAdapterBrowserMessage(session, changedPlan, deps);
    await handleCodexAdapterBrowserMessage(session, changedPlan, deps);

    const accepted = todoWriteMessages(session.messageHistory);
    expect(accepted).toHaveLength(2);
    expect(todoWriteMessages(broadcasts)).toEqual(accepted);
    expect(persistSession).toHaveBeenCalledTimes(2);
    const acceptedChange = accepted[1]!;
    const acceptedChangeToolId = todoWriteBlock(acceptedChange).id;
    expect(acceptedChangeToolId).toMatch(/-2$/);
    expect(acceptedChange.message.id).toBe(`codex-tool_use-${acceptedChangeToolId}`);
    expect(Object.keys(acceptedChange.tool_start_times ?? {})).toEqual([acceptedChangeToolId]);
    expect(
      (todoWriteBlock(acceptedChange).input.todos as Array<{ status: string }>).map((todo) => todo.status),
    ).toEqual(["completed", "in_progress", "pending"]);
  });

  it("keeps identical states isolated by turn and native-child ownership", async () => {
    // Plan replay authority is scoped to the provider turn plus the existing
    // route/parent/native-child ownership boundaries. Identical states from a
    // different turn or child must remain independent visible audit entries.
    const firstMessages: BrowserIncomingMessage[] = [];
    const firstManager = new CodexItemEventManager((message) => firstMessages.push(message), {});
    firstManager.emitPlanTodoWrite(
      planUpdate("turn-plan-owner-a", ["inProgress", "pending", "pending"]),
      "turn_plan_updated",
    );

    const secondMessages: BrowserIncomingMessage[] = [];
    const secondManager = new CodexItemEventManager((message) => secondMessages.push(message), {});
    secondManager.emitPlanTodoWrite(
      planUpdate("turn-plan-owner-b", ["inProgress", "pending", "pending"]),
      "turn_plan_updated",
    );

    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const persistSession = vi.fn<(session: unknown) => void>();
    const deps = makeControllerDeps(broadcasts, persistSession);
    await handleCodexAdapterBrowserMessage(session, todoWriteMessages(firstMessages)[0]!, deps);
    await handleCodexAdapterBrowserMessage(session, todoWriteMessages(secondMessages)[0]!, deps);

    const childBase = todoWriteMessages(firstMessages)[0]!;
    const childOne = {
      ...childBase,
      codexSubagent: { childId: "child-one", rootTurnId: "root-turn" },
    } satisfies AssistantMessage;
    const childTwo = {
      ...childBase,
      codexSubagent: { childId: "child-two", rootTurnId: "root-turn" },
    } satisfies AssistantMessage;
    await handleCodexAdapterBrowserMessage(session, childOne, deps);
    await handleCodexAdapterBrowserMessage(session, childTwo, deps);
    await handleCodexAdapterBrowserMessage(session, childOne, deps);

    const accepted = todoWriteMessages(session.messageHistory);
    expect(accepted).toHaveLength(4);
    expect(todoWriteMessages(broadcasts)).toEqual(accepted);
    expect(accepted.slice(0, 2).map((message) => todoWriteBlock(message).id)).toEqual([
      "codex-plan-turn-plan-owner-a-1",
      "codex-plan-turn-plan-owner-b-1",
    ]);
    expect(accepted.slice(2).map((message) => message.codexSubagent?.childId)).toEqual(["child-one", "child-two"]);
    expect(new Set(accepted.map((message) => todoWriteBlock(message).id)).size).toBe(4);
  });
});
