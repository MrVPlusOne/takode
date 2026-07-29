import type { Context, Hono } from "hono";
import { getSettings } from "../settings-manager.js";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";
import type { SessionStore } from "../session-store.js";

const DELEGATE_TIMEOUT_MS = 5 * 60 * 1000;
const DELEGATE_CHILD_MONITOR_INTERVAL_MS = 250;

type PendingDelegate = {
  delegateId: string;
  parentSessionId: string;
  childSessionId?: string;
  task: string;
  resolve: (result: DelegateResolution) => void;
  timer: ReturnType<typeof setTimeout>;
  stopMonitor?: () => void;
};

type DelegateTraceEvent = {
  kind: "assistant" | "tool";
  label: string;
  toolUseId?: string;
  text?: string;
  status?: "running" | "completed" | "failed";
  isError?: boolean;
  isTruncated?: boolean;
  totalSize?: number;
  timestamp?: number;
};

const pendingDelegates = new Map<string, PendingDelegate>();

type DelegateResolution = {
  summary: string;
  isError?: boolean;
};

function createDelegateId(): string {
  return "del_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function buildDelegatePrompt(args: { parentSessionNum?: number | null; delegateId: string; task: string }): string {
  const parentLabel = args.parentSessionNum ? "#" + args.parentSessionNum : "the parent leader session";
  return [
    "You are a forked task-delegate copy of the parent leader session.",
    "",
    "You have the parent leader's prior context, but your role is now narrow: complete the delegated task below, summarize what the parent needs to know, call the MCP tool named end_delegation, and stop.",
    "",
    "Takode handoff contract:",
    "- The actual MCP tool mcp:takode_delegate:end_delegation is a mandatory control-plane handoff, not optional task work.",
    '- If the delegated task says "do not use tools", "do not run shell commands", or gives similar tool-use limits, apply that only to doing the task. Those limits do not forbid the required end_delegation handoff.',
    "- Once the delegated task is done or you know it cannot be completed, you must always call the actual mcp:takode_delegate:end_delegation tool with the summary.",
    "- Do not finish with a normal final answer. The parent only receives completion through the MCP tool result.",
    "",
    "Delegated task:",
    args.task,
    "",
    "Context:",
    "- Parent session: " + parentLabel,
    "- Delegate id: " + args.delegateId,
    "- Full delegate transcript and raw task evidence will remain inspectable by the parent.",
    "",
    "Rules:",
    "- Work only on the delegated task.",
    "- Do not fork/delegate again.",
    "- Do not ask the user.",
    "- Do not continue unrelated work.",
    "- Do not paste huge raw output into end_delegation.",
    "- You may see delegate_task and end_delegation. Do not call delegate_task from this hidden delegate; Takode will reject nested delegation.",
    "- When you are ready to hand off, call the actual MCP tool mcp:takode_delegate:end_delegation with a summary argument.",
    '- Do not write textual function-call prose such as end_delegation("..."). Text shaped like a function call does not notify the parent.',
    "- If any action has obvious side effects, mention them.",
    "- If the task fails or cannot be safely summarized, explain that.",
    "- Use your judgment to summarize what the parent leader needs next.",
    "",
    'Your final action must be the actual MCP tool call: mcp:takode_delegate:end_delegation({ summary: "..." }).',
  ].join("\n");
}

async function waitForCodexAdapter(
  wsBridge: WsBridge,
  sessionId: string,
): Promise<NonNullable<ReturnType<WsBridge["getSession"]>>["codexAdapter"]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const session = wsBridge.getSession(sessionId);
    if (session?.codexAdapter?.isConnected?.()) return session.codexAdapter;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function formatParentResult(args: {
  delegateId: string;
  childSessionNum?: number | null;
  task: string;
  summary: string;
  isError?: boolean;
}): string {
  const link = args.childSessionNum
    ? "[#" + args.childSessionNum + "](session:" + args.childSessionNum + ")"
    : "delegate " + args.delegateId;
  return [
    args.isError ? "Delegate task failed." : "Delegate task completed.",
    "",
    args.childSessionNum ? "Delegate: " + args.delegateId + " (" + link + ")" : "Delegate: " + args.delegateId,
    "Task: " + args.task,
    "",
    "Summary:",
    args.summary.trim(),
    "",
    "Inspect:",
    args.childSessionNum
      ? "- Delegate transcript/raw output: " + link
      : "- Expand the Delegate task card to inspect the delegate trace/raw-output link for " + link + ".",
  ].join("\n");
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const rec = block as Record<string, unknown>;
      if (rec.type === "text" && typeof rec.text === "string") return rec.text;
      if (rec.type === "tool_result" && typeof rec.content === "string") return rec.content;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  if (toolName === "Bash" && typeof rec.command === "string") return rec.command;
  if (typeof rec.summary === "string") return rec.summary;
  if (typeof rec.command === "string") return rec.command;
  return "";
}

function boundTraceText(text: string, maxChars = 800): Pick<DelegateTraceEvent, "text" | "isTruncated" | "totalSize"> {
  const totalSize = text.length;
  if (totalSize <= maxChars) return { text, totalSize };
  return { text: text.slice(0, maxChars) + "…", totalSize, isTruncated: true };
}

function traceEventsFromChildSession(childSession: any): DelegateTraceEvent[] {
  const events: DelegateTraceEvent[] = [];
  const history = Array.isArray(childSession?.messageHistory) ? childSession.messageHistory : [];
  const toolNameById = new Map<string, string>();
  for (const entry of history) {
    const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : undefined;
    if (entry?.type === "tool_result_preview" && Array.isArray(entry.previews)) {
      for (const preview of entry.previews) {
        if (!preview || typeof preview !== "object") continue;
        const rec = preview as Record<string, unknown>;
        const toolUseId = typeof rec.tool_use_id === "string" ? rec.tool_use_id : undefined;
        const toolName = toolUseId ? toolNameById.get(toolUseId) : undefined;
        const content = typeof rec.content === "string" ? rec.content : "";
        events.push({
          kind: "tool",
          label: toolName ? toolName + " result" : "Result",
          toolUseId,
          ...boundTraceText(content, 800),
          status: rec.is_error ? "failed" : "completed",
          isError: rec.is_error === true,
          isTruncated: rec.is_truncated === true,
          totalSize: typeof rec.total_size === "number" ? rec.total_size : content.length,
          timestamp,
        });
      }
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const rec = block as Record<string, unknown>;
      if (rec.type === "text") {
        const text = textFromContent([rec]);
        if (text) events.push({ kind: "assistant", label: "Assistant", ...boundTraceText(text), timestamp });
      } else if (rec.type === "tool_use") {
        const name = typeof rec.name === "string" ? rec.name : "tool";
        const toolUseId = typeof rec.id === "string" ? rec.id : undefined;
        if (toolUseId) toolNameById.set(toolUseId, name);
        events.push({
          kind: "tool",
          label: name,
          toolUseId,
          ...boundTraceText(summarizeToolInput(name, rec.input), 400),
          status: "running",
          timestamp,
        });
      } else if (rec.type === "tool_result") {
        const resultText = textFromContent([rec]);
        events.push({
          kind: "tool",
          label: "Result",
          toolUseId: typeof rec.tool_use_id === "string" ? rec.tool_use_id : undefined,
          ...boundTraceText(resultText),
          status: rec.is_error ? "failed" : "completed",
          isError: rec.is_error === true,
          timestamp,
        });
      }
    }
  }
  return events;
}

function findDelegateChildById(wsBridge: WsBridge, launcher: CliLauncher, parentSessionId: string, delegateId: string) {
  for (const info of launcher.listSessions?.() ?? []) {
    const session = wsBridge.getSession(info.sessionId);
    const delegateChild = (session?.state as any)?.delegateChild as
      | { parentSessionId?: string; delegateId?: string; task?: string; command?: string }
      | undefined;
    if (delegateChild?.parentSessionId === parentSessionId && delegateChild.delegateId === delegateId) {
      return { info, session, delegateChild };
    }
  }
  return null;
}

function findLatestDelegateChildByTask(
  wsBridge: WsBridge,
  launcher: CliLauncher,
  parentSessionId: string,
  task: string,
) {
  const matches: Array<NonNullable<ReturnType<typeof findDelegateChildById>>> = [];
  for (const info of launcher.listSessions?.() ?? []) {
    const session = wsBridge.getSession(info.sessionId);
    const delegateChild = (session?.state as any)?.delegateChild as
      | { parentSessionId?: string; delegateId?: string; task?: string; command?: string }
      | undefined;
    if (
      delegateChild?.parentSessionId === parentSessionId &&
      (delegateChild.task === task || delegateChild.command === task)
    ) {
      matches.push({ info, session, delegateChild });
    }
  }
  matches.sort((a, b) => (b.info.createdAt ?? 0) - (a.info.createdAt ?? 0));
  return matches[0] ?? null;
}

function delegateTraceResponse(args: {
  delegateId: string;
  task: string;
  command?: string;
  childSessionId?: string;
  childSessionNum?: number | null;
  childSession: any;
  pending: boolean;
}) {
  const rawOutputLink = args.childSessionNum
    ? { kind: "session" as const, label: "#" + args.childSessionNum, sessionNum: args.childSessionNum }
    : args.childSessionId
      ? { kind: "delegate" as const, label: args.delegateId, sessionId: args.childSessionId }
      : null;
  const baseTrace = traceEventsFromChildSession(args.childSession);
  const liveActivity = args.pending ? args.childSession?.delegateLiveActivity : null;
  const hasLiveActivityInTrace =
    liveActivity &&
    typeof liveActivity === "object" &&
    baseTrace.some((event) => event.kind === liveActivity.kind && event.text === liveActivity.text);
  const trace =
    liveActivity && typeof liveActivity === "object" && !hasLiveActivityInTrace
      ? [
          ...baseTrace,
          {
            ...(liveActivity as DelegateTraceEvent),
            status: args.childSession?.isGenerating ? "running" : "completed",
          },
        ]
      : baseTrace;
  return {
    delegateId: args.delegateId,
    task: args.task,
    ...(args.command ? { command: args.command } : {}),
    childSessionId: args.childSessionId ?? null,
    childSessionNum: args.childSessionNum ?? null,
    pending: args.pending,
    childStatus: args.pending ? (args.childSession?.isGenerating ? "running" : "stopped") : "complete",
    trace,
    rawOutputLink,
  };
}

function resolvePendingDelegate(delegateId: string, result: DelegateResolution): void {
  const pending = pendingDelegates.get(delegateId);
  if (!pending) return;
  pendingDelegates.delete(delegateId);
  clearTimeout(pending.timer);
  pending.stopMonitor?.();
  pending.resolve(result);
}

async function archiveCompletedDelegateChild(args: {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  sessionStore?: SessionStore;
  childSessionId?: string;
}): Promise<void> {
  if (!args.childSessionId) return;
  const childInfo = args.launcher.getSession(args.childSessionId);
  const childSession = args.wsBridge.getSession(args.childSessionId);
  const delegateChild = (childSession?.state as any)?.delegateChild as
    | { parentSessionId?: string; delegateId?: string; task?: string; command?: string }
    | undefined;
  if (!childInfo?.hidden || !delegateChild?.delegateId) return;

  const wasArchived = childInfo.archived === true;
  if (!wasArchived) {
    args.launcher.setArchived(args.childSessionId, true);
  }
  try {
    await args.launcher.kill(args.childSessionId);
  } catch (error) {
    console.warn(
      `[delegate] Failed to stop completed delegate child ${args.childSessionId.slice(0, 8)} during archival:`,
      error,
    );
  }
  args.wsBridge.persistSessionById(args.childSessionId);
  try {
    await args.sessionStore?.setArchived(args.childSessionId, true);
  } catch (error) {
    console.warn(
      `[delegate] Failed to persist archived state for delegate child ${args.childSessionId.slice(0, 8)}:`,
      error,
    );
  }
  if (!wasArchived) {
    (args.wsBridge as any).broadcastGlobal?.({
      type: "session_archived",
      session_id: args.childSessionId,
      archivedAt: args.launcher.getSession(args.childSessionId)?.archivedAt,
    });
  }
}

function startDelegateChildCompletionMonitor(args: {
  wsBridge: WsBridge;
  delegateId: string;
  childSessionId: string;
}): () => void {
  const interval = setInterval(() => {
    if (!pendingDelegates.has(args.delegateId)) {
      clearInterval(interval);
      return;
    }
    const childSession = args.wsBridge.getSession(args.childSessionId);
    if (!childSession) {
      resolvePendingDelegate(args.delegateId, {
        summary: "Delegate child session disappeared before calling end_delegation.",
        isError: true,
      });
      return;
    }
  }, DELEGATE_CHILD_MONITOR_INTERVAL_MS);
  return () => clearInterval(interval);
}

export function registerSessionDelegateRoutes(
  api: Hono,
  deps: {
    launcher: CliLauncher;
    wsBridge: WsBridge;
    sessionStore?: SessionStore;
    resolveId: (id: string) => string | null;
    authenticateTakodeCaller: (c: Context, opts?: { requireOrchestrator?: boolean }) => any;
  },
): void {
  const { launcher, wsBridge, sessionStore, resolveId, authenticateTakodeCaller } = deps;

  api.post("/sessions/:id/delegates/task", async (c) => {
    const auth = authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;
    const parentSessionId = resolveId(c.req.param("id"));
    if (!parentSessionId) return c.json({ error: "Session not found" }, 404);
    if (auth.callerId !== parentSessionId) return c.json({ error: "callerSessionId does not match path session" }, 403);

    const parent = wsBridge.getSession(parentSessionId);
    const parentInfo = launcher.getSession(parentSessionId);
    if (!parent || !parentInfo) return c.json({ error: "Session not found" }, 404);
    if (parentInfo.backendType !== "codex" && parent.state.backend_type !== "codex") {
      return c.json({ error: "delegate_task is only available for Codex sessions" }, 400);
    }
    if (parent.state.hidden || parentInfo.hidden) {
      return c.json({ error: "delegate_task is not available from hidden delegate sessions" }, 400);
    }
    const adapter = parent.codexAdapter;
    if (!adapter?.forkThread) return c.json({ error: "Codex native fork is unavailable" }, 409);
    const body = await c.req.json().catch(() => ({}));
    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!task) return c.json({ error: "task is required" }, 400);

    const delegateId = createDelegateId();
    const forkedThreadId = await adapter.forkThread();
    const settings = getSettings();
    const child = await launcher.launch({
      backendType: "codex",
      cwd: parent.state.cwd || parentInfo.cwd,
      model: parent.state.model || parentInfo.model,
      permissionMode: parentInfo.permissionMode,
      askPermission: parentInfo.askPermission ?? true,
      uiMode: parentInfo.uiMode ?? "agent",
      codexBinary: settings.codexBinary || undefined,
      codexSandbox: parentInfo.codexSandbox,
      codexInternetAccess: parentInfo.codexInternetAccess === true,
      codexReasoningEffort: parentInfo.codexReasoningEffort,
      codexServiceTier: parentInfo.codexServiceTier ?? null,
      codexHome: parentInfo.codexHome,
      codexResumeSourceSessionId: parentSessionId,
      requireResumeCliSessionId: true,
      envSlug: parentInfo.envSlug,
      env: {
        ...(parentInfo.isOrchestrator
          ? { TAKODE_ROLE: "orchestrator", TAKODE_API_PORT: String(launcher.getPort()) }
          : {}),
        TAKODE_DELEGATE_ROLE: "child",
        TAKODE_DELEGATE_ID: delegateId,
        TAKODE_DELEGATE_PARENT_SESSION_ID: parentSessionId,
      },
      extraInstructions: parentInfo.isOrchestrator ? launcher.getOrchestratorGuardrails("codex") : undefined,
      isOrchestrator: parentInfo.isOrchestrator === true,
      resumeCliSessionId: forkedThreadId,
      hidden: true,
      publicSessionNumber: false,
      parentSessionId,
    });
    child.hidden = true;
    child.parentSessionId = parentSessionId;
    child.noAutoName = true;

    const childSession = wsBridge.getOrCreateSession(child.sessionId, "codex");
    childSession.state.hidden = true;
    childSession.state.cwd = parent.state.cwd || parentInfo.cwd;
    childSession.state.model = child.model || parentInfo.model || parent.state.model || "";
    childSession.state.modelProvenanceMigration = child.modelProvenanceMigration;
    childSession.state.treeGroupId = parent.state.treeGroupId ?? "default";
    childSession.state.memorySessionSpaceSlug = parent.state.memorySessionSpaceSlug;
    (childSession.state as any).delegateChild = { parentSessionId, delegateId, task };
    wsBridge.persistSessionById(child.sessionId);

    const prompt = buildDelegatePrompt({
      parentSessionNum: launcher.getSessionNum(parentSessionId),
      delegateId,
      task,
    });
    const childAdapter = await waitForCodexAdapter(wsBridge, child.sessionId);
    if (!childAdapter) {
      await archiveCompletedDelegateChild({ launcher, wsBridge, sessionStore, childSessionId: child.sessionId });
      return c.json({ error: "Delegate session did not connect", delegateId }, 504);
    }
    const childThreadId =
      typeof (childAdapter as any).getThreadId === "function" ? (childAdapter as any).getThreadId() : null;
    if (childThreadId !== forkedThreadId) {
      await archiveCompletedDelegateChild({ launcher, wsBridge, sessionStore, childSessionId: child.sessionId });
      return c.json(
        {
          error: "Delegate child did not resume the expected forked Codex thread before the task prompt",
          delegateId,
          childSessionId: child.sessionId,
          expectedThreadId: forkedThreadId,
          actualThreadId: childThreadId,
        },
        504,
      );
    }
    const childMcpReady = await childAdapter.waitForMcpToolAvailability?.("takode_delegate", "end_delegation", 10_000);
    if (!childMcpReady) {
      await archiveCompletedDelegateChild({ launcher, wsBridge, sessionStore, childSessionId: child.sessionId });
      return c.json(
        {
          error: "Delegate end_delegation tool did not become available before the task prompt",
          delegateId,
          childSessionId: child.sessionId,
        },
        504,
      );
    }

    const summaryPromise = new Promise<DelegateResolution>((resolve) => {
      const timer = setTimeout(() => {
        resolvePendingDelegate(delegateId, {
          summary:
            "Delegate timed out before calling end_delegation. Inspect the delegate session transcript for partial output.",
          isError: true,
        });
      }, DELEGATE_TIMEOUT_MS);
      pendingDelegates.set(delegateId, {
        delegateId,
        parentSessionId,
        childSessionId: child.sessionId,
        task,
        resolve,
        timer,
      });
    });
    const pending = pendingDelegates.get(delegateId);
    if (pending) {
      pending.stopMonitor = startDelegateChildCompletionMonitor({
        wsBridge,
        delegateId,
        childSessionId: child.sessionId,
      });
    }

    const sent = childAdapter.sendBrowserMessage({
      type: "user_message",
      content: prompt,
      inputSource: "programmatic",
      autoPauseSourceKind: "system",
    } as any);
    if (sent === false) {
      resolvePendingDelegate(delegateId, {
        summary: "Delegate prompt could not be sent to the hidden child session.",
        isError: true,
      });
    }

    const result = await summaryPromise;
    await archiveCompletedDelegateChild({
      launcher,
      wsBridge,
      sessionStore,
      childSessionId: child.sessionId,
    });
    const childSessionNum = launcher.getSessionNum(child.sessionId);
    const text = formatParentResult({
      delegateId,
      childSessionNum,
      task,
      summary: result.summary,
      isError: result.isError,
    });
    return c.json({
      text,
      delegateId,
      childSessionId: child.sessionId,
      childSessionNum: childSessionNum ?? null,
      isError: result.isError,
    });
  });

  api.get("/sessions/:id/delegates/trace", (c) => {
    const parentSessionId = resolveId(c.req.param("id"));
    if (!parentSessionId) return c.json({ error: "Session not found" }, 404);
    const delegateId = typeof c.req.query("delegateId") === "string" ? c.req.query("delegateId")!.trim() : "";
    const task = typeof c.req.query("task") === "string" ? c.req.query("task")!.trim() : "";
    const legacyCommand = typeof c.req.query("command") === "string" ? c.req.query("command")!.trim() : "";
    const taskOrLegacyCommand = task || legacyCommand;
    let resolved: ReturnType<typeof findDelegateChildById> | ReturnType<typeof findLatestDelegateChildByTask> = null;
    if (delegateId) resolved = findDelegateChildById(wsBridge, launcher, parentSessionId, delegateId);
    if (!resolved && taskOrLegacyCommand)
      resolved = findLatestDelegateChildByTask(wsBridge, launcher, parentSessionId, taskOrLegacyCommand);
    if (!resolved) return c.json({ error: "Delegate trace not found" }, 404);
    const pending = pendingDelegates.has(resolved.delegateChild.delegateId ?? "");
    return c.json(
      delegateTraceResponse({
        delegateId: resolved.delegateChild.delegateId ?? delegateId,
        task: resolved.delegateChild.task ?? resolved.delegateChild.command ?? taskOrLegacyCommand,
        command: resolved.delegateChild.command,
        childSessionId: resolved.info.sessionId,
        childSessionNum: launcher.getSessionNum(resolved.info.sessionId) ?? null,
        childSession: resolved.session,
        pending,
      }),
    );
  });

  api.post("/sessions/:id/delegates/end", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const childSessionId = resolveId(c.req.param("id"));
    if (!childSessionId) return c.json({ error: "Session not found" }, 404);
    if (auth.callerId !== childSessionId) return c.json({ error: "callerSessionId does not match path session" }, 403);
    const childInfo = launcher.getSession(childSessionId);
    const childSession = wsBridge.getSession(childSessionId);
    const delegateChild = (childSession?.state as any)?.delegateChild as
      | { parentSessionId?: string; delegateId?: string; task?: string; command?: string }
      | undefined;
    if (!childInfo?.hidden || !childSession?.state.hidden || !delegateChild?.delegateId) {
      return c.json({ error: "end_delegation is only available from an active hidden delegate child" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const delegateId = typeof body.delegateId === "string" ? body.delegateId.trim() : "";
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    if (!delegateId) return c.json({ error: "delegateId is required" }, 400);
    if (!summary) return c.json({ error: "summary is required" }, 400);
    if (delegateChild.delegateId !== delegateId)
      return c.json({ error: "delegateId does not match child session" }, 403);
    const pending = pendingDelegates.get(delegateId);
    if (!pending) return c.json({ error: "Delegation was already resolved or is no longer pending." }, 409);
    if (pending.childSessionId !== childSessionId)
      return c.json({ error: "delegateId does not match child session" }, 403);
    resolvePendingDelegate(delegateId, { summary });
    return c.json({ text: "Delegation summary delivered to parent." });
  });
}
