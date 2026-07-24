import type { Context, Hono } from "hono";
import { getSettings } from "../settings-manager.js";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";

const DELEGATE_TIMEOUT_MS = 5 * 60 * 1000;
const DELEGATE_CHILD_MONITOR_INTERVAL_MS = 250;

type PendingDelegate = {
  delegateId: string;
  parentSessionId: string;
  childSessionId?: string;
  command: string;
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

function buildDelegatePrompt(args: { parentSessionNum?: number | null; delegateId: string; command: string }): string {
  const parentLabel = args.parentSessionNum ? "#" + args.parentSessionNum : "the parent leader session";
  return [
    "You are a forked command-delegate copy of the parent leader session.",
    "",
    "You have the parent leader's prior context, but your role is now narrow: run the delegated command below, summarize what the parent needs to know, call the MCP tool named end_delegation, and stop.",
    "",
    "Delegated command:",
    args.command,
    "",
    "Context:",
    "- Parent session: " + parentLabel,
    "- Delegate id: " + args.delegateId,
    "- Full delegate transcript and raw command output will remain inspectable by the parent.",
    "",
    "Rules:",
    "- Run the delegated command exactly once.",
    "- Do not fork/delegate again.",
    "- Do not ask the user.",
    "- Do not continue unrelated work.",
    "- Do not paste huge raw output into end_delegation.",
    "- You may see delegate_command and end_delegation. Do not call delegate_command from this hidden delegate; Takode will reject nested delegation.",
    "- When you are ready to hand off, call the actual MCP tool mcp:takode_delegate:end_delegation with a summary argument.",
    '- Do not write textual function-call prose such as end_delegation("..."). Text shaped like a function call does not notify the parent.',
    "- Do not finish with a normal final answer. The parent only receives completion through the MCP tool result.",
    "- If the command has obvious side effects, mention them.",
    "- If the command fails or cannot be safely summarized, explain that.",
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
  command: string;
  summary: string;
  isError?: boolean;
}): string {
  const link = args.childSessionNum
    ? "[#" + args.childSessionNum + "](session:" + args.childSessionNum + ")"
    : "delegate " + args.delegateId;
  return [
    args.isError ? "Delegate command failed." : "Delegate command completed.",
    "",
    args.childSessionNum ? "Delegate: " + args.delegateId + " (" + link + ")" : "Delegate: " + args.delegateId,
    "Command: " + args.command,
    "",
    "Summary:",
    args.summary.trim(),
    "",
    "Inspect:",
    args.childSessionNum
      ? "- Delegate transcript/raw output: " + link
      : "- Expand the Delegate command card to inspect the delegate trace/raw-output link for " + link + ".",
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
      | { parentSessionId?: string; delegateId?: string; command?: string }
      | undefined;
    if (delegateChild?.parentSessionId === parentSessionId && delegateChild.delegateId === delegateId) {
      return { info, session, delegateChild };
    }
  }
  return null;
}

function findLatestDelegateChildByCommand(
  wsBridge: WsBridge,
  launcher: CliLauncher,
  parentSessionId: string,
  command: string,
) {
  const matches: Array<NonNullable<ReturnType<typeof findDelegateChildById>>> = [];
  for (const info of launcher.listSessions?.() ?? []) {
    const session = wsBridge.getSession(info.sessionId);
    const delegateChild = (session?.state as any)?.delegateChild as
      | { parentSessionId?: string; delegateId?: string; command?: string }
      | undefined;
    if (delegateChild?.parentSessionId === parentSessionId && delegateChild.command === command) {
      matches.push({ info, session, delegateChild });
    }
  }
  matches.sort((a, b) => (b.info.createdAt ?? 0) - (a.info.createdAt ?? 0));
  return matches[0] ?? null;
}

function delegateTraceResponse(args: {
  delegateId: string;
  command: string;
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
  return {
    delegateId: args.delegateId,
    command: args.command,
    childSessionId: args.childSessionId ?? null,
    childSessionNum: args.childSessionNum ?? null,
    pending: args.pending,
    trace: traceEventsFromChildSession(args.childSession),
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
    resolveId: (id: string) => string | null;
    authenticateTakodeCaller: (c: Context, opts?: { requireOrchestrator?: boolean }) => any;
  },
): void {
  const { launcher, wsBridge, resolveId, authenticateTakodeCaller } = deps;

  api.post("/sessions/:id/delegates/command", async (c) => {
    const auth = authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;
    const parentSessionId = resolveId(c.req.param("id"));
    if (!parentSessionId) return c.json({ error: "Session not found" }, 404);
    if (auth.callerId !== parentSessionId) return c.json({ error: "callerSessionId does not match path session" }, 403);

    const parent = wsBridge.getSession(parentSessionId);
    const parentInfo = launcher.getSession(parentSessionId);
    if (!parent || !parentInfo) return c.json({ error: "Session not found" }, 404);
    if (parentInfo.backendType !== "codex" && parent.state.backend_type !== "codex") {
      return c.json({ error: "delegate_command is only available for Codex sessions" }, 400);
    }
    if (parent.state.hidden || parentInfo.hidden) {
      return c.json({ error: "delegate_command is not available from hidden delegate sessions" }, 400);
    }
    const adapter = parent.codexAdapter;
    if (!adapter?.forkThread) return c.json({ error: "Codex native fork is unavailable" }, 409);
    const body = await c.req.json().catch(() => ({}));
    const command = typeof body.command === "string" ? body.command.trim() : "";
    if (!command) return c.json({ error: "command is required" }, 400);

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
    childSession.state.model = parent.state.model || parentInfo.model || "";
    childSession.state.treeGroupId = parent.state.treeGroupId ?? "default";
    childSession.state.memorySessionSpaceSlug = parent.state.memorySessionSpaceSlug;
    (childSession.state as any).delegateChild = { parentSessionId, delegateId, command };
    wsBridge.persistSessionById(child.sessionId);

    const prompt = buildDelegatePrompt({
      parentSessionNum: launcher.getSessionNum(parentSessionId),
      delegateId,
      command,
    });
    const childAdapter = await waitForCodexAdapter(wsBridge, child.sessionId);
    if (!childAdapter) return c.json({ error: "Delegate session did not connect", delegateId }, 504);
    const childMcpReady = await childAdapter.waitForMcpToolAvailability?.("takode_delegate", "end_delegation", 10_000);
    if (!childMcpReady) {
      return c.json(
        {
          error: "Delegate end_delegation tool did not become available before the command prompt",
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
        command,
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
    const childSessionNum = launcher.getSessionNum(child.sessionId);
    const text = formatParentResult({
      delegateId,
      childSessionNum,
      command,
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
    const command = typeof c.req.query("command") === "string" ? c.req.query("command")!.trim() : "";
    let resolved: ReturnType<typeof findDelegateChildById> | ReturnType<typeof findLatestDelegateChildByCommand> = null;
    if (delegateId) resolved = findDelegateChildById(wsBridge, launcher, parentSessionId, delegateId);
    if (!resolved && command) resolved = findLatestDelegateChildByCommand(wsBridge, launcher, parentSessionId, command);
    if (!resolved) return c.json({ error: "Delegate trace not found" }, 404);
    const pending = pendingDelegates.has(resolved.delegateChild.delegateId ?? "");
    return c.json(
      delegateTraceResponse({
        delegateId: resolved.delegateChild.delegateId ?? delegateId,
        command: resolved.delegateChild.command ?? command,
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
      | { parentSessionId?: string; delegateId?: string; command?: string }
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
