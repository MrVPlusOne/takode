import type { Hono } from "hono";
import * as sessionNames from "../session-names.js";
import { getSettings } from "../settings-manager.js";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";
import type { BackendType } from "../session-types.js";
import {
  computeCodexSlackThreadForkPlan,
  createSlackThreadId,
  findRootAssistantAnchor,
} from "../slack-thread-branches.js";

type ForkClaudeSession = (
  sessionId: string,
  options: { dir?: string; upToMessageId?: string; title?: string },
) => Promise<{ sessionId: string }>;

async function defaultForkClaudeSession(
  sessionId: string,
  options: { dir?: string; upToMessageId?: string; title?: string },
): Promise<{ sessionId: string }> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.forkSession !== "function") throw new Error("Claude SDK forkSession is unavailable");
  return sdk.forkSession(sessionId, options);
}

export function registerSessionSlackThreadRoutes(
  api: Hono,
  deps: {
    launcher: CliLauncher;
    wsBridge: WsBridge;
    resolveId: (id: string) => string | null;
    forkClaudeSession?: ForkClaudeSession;
  },
): void {
  const { launcher, wsBridge, resolveId, forkClaudeSession = defaultForkClaudeSession } = deps;

  const blockedChildEnvKeys = [
    "COMPANION_AUTH_TOKEN",
    "COMPANION_SESSION_ID",
    "COMPANION_SESSION_NUMBER",
    "TAKODE_ROLE",
    "TAKODE_API_PORT",
  ];

  const getInheritedChildEnv = (rootSessionId: string): Record<string, string> | undefined => {
    const rootEnv = launcher.getSessionLaunchEnv(rootSessionId);
    if (!rootEnv) return undefined;
    const inherited = { ...rootEnv };
    for (const key of blockedChildEnvKeys) {
      delete inherited[key];
    }
    return inherited;
  };

  const isLeaderSession = (root: ReturnType<WsBridge["getSession"]>, rootInfo: ReturnType<CliLauncher["getSession"]>) =>
    root?.state.isOrchestrator === true || rootInfo?.isOrchestrator === true;

  const tryCreateNativeFork = async (
    backend: BackendType,
    root: NonNullable<ReturnType<WsBridge["getSession"]>>,
    rootInfo: NonNullable<ReturnType<CliLauncher["getSession"]>>,
    anchor: NonNullable<ReturnType<typeof findRootAssistantAnchor>>,
  ): Promise<
    { strategy: "native-fork"; resumeCliSessionId: string } | { strategy: "bounded-replay"; fallbackReason: string }
  > => {
    const title = `Thread: ${anchor.preview || anchor.message.message.id}`;
    if (backend === "codex") {
      const plan = computeCodexSlackThreadForkPlan(root.messageHistory, anchor.message.message.id);
      if (!plan.ok) return { strategy: "bounded-replay", fallbackReason: `Codex native fork skipped: ${plan.reason}` };
      const adapter = root.codexAdapter;
      if (!adapter?.forkThread || !adapter.isConnected?.()) {
        return {
          strategy: "bounded-replay",
          fallbackReason: "Codex native fork unavailable: root adapter is not connected",
        };
      }
      try {
        const forkedThreadId = await adapter.forkThread({ rollbackTurns: plan.rollbackTurns || undefined });
        return { strategy: "native-fork", resumeCliSessionId: forkedThreadId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { strategy: "bounded-replay", fallbackReason: `Codex native fork failed: ${message}` };
      }
    }
    if (backend === "claude-sdk") {
      const upToMessageId = anchor.message.uuid || anchor.message.message.id;
      if (!rootInfo.cliSessionId || !upToMessageId) {
        return {
          strategy: "bounded-replay",
          fallbackReason: "Claude native fork unavailable: missing session or anchor id",
        };
      }
      try {
        const forked = await forkClaudeSession(rootInfo.cliSessionId, {
          dir: root.state.cwd || rootInfo.cwd,
          upToMessageId,
          title,
        });
        return { strategy: "native-fork", resumeCliSessionId: forked.sessionId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { strategy: "bounded-replay", fallbackReason: `Claude native fork failed: ${message}` };
      }
    }
    return { strategy: "bounded-replay", fallbackReason: `Native fork unavailable for backend ${backend}` };
  };

  api.post("/sessions/:id/slack-threads", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const root = wsBridge.getSession(id);
    const rootInfo = launcher.getSession(id);
    if (!root || !rootInfo) return c.json({ error: "Session not found" }, 404);
    if (root.state.slackThreadChild || rootInfo.hidden) {
      return c.json({ error: "Threads can only start from a root session" }, 400);
    }
    if (isLeaderSession(root, rootInfo)) {
      return c.json({ error: "Slack threads are disabled for leader sessions" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const anchorMessageId = typeof body.anchorMessageId === "string" ? body.anchorMessageId.trim() : "";
    if (!anchorMessageId) return c.json({ error: "anchorMessageId is required" }, 400);

    const existing = Object.values(root.state.slackThreads ?? {}).find(
      (thread) => thread.anchorMessageId === anchorMessageId,
    );
    if (existing) {
      wsBridge.syncSlackThreadRecord(id, existing.id);
      return c.json({ ok: true, thread: root.state.slackThreads?.[existing.id] ?? existing });
    }

    const anchor = findRootAssistantAnchor(root.messageHistory, anchorMessageId);
    if (!anchor) return c.json({ error: "Anchor must be a root assistant message" }, 400);

    const threadId = createSlackThreadId();
    const backend = (rootInfo.backendType || root.state.backend_type || "claude") as BackendType;
    const binarySettings = getSettings();
    const permissionMode = backend === "codex" ? rootInfo.permissionMode || "codex-default" : "default";
    const forkContext = await tryCreateNativeFork(backend, root, rootInfo, anchor);
    const child = await launcher.launch({
      backendType: backend,
      cwd: root.state.cwd || rootInfo.cwd,
      model: root.state.model || rootInfo.model,
      permissionMode,
      askPermission: rootInfo.askPermission ?? true,
      uiMode: rootInfo.uiMode ?? "agent",
      claudeBinary: binarySettings.claudeBinary || undefined,
      codexBinary: binarySettings.codexBinary || undefined,
      codexSandbox: backend === "codex" ? "read-only" : undefined,
      codexInternetAccess: backend === "codex" ? rootInfo.codexInternetAccess === true : undefined,
      codexReasoningEffort: backend === "codex" ? rootInfo.codexReasoningEffort : undefined,
      env: getInheritedChildEnv(id),
      envSlug: rootInfo.envSlug,
      blockedEnvKeys: blockedChildEnvKeys,
      memorySessionSpaceSlug: root.state.memorySessionSpaceSlug,
      ...(forkContext.strategy === "native-fork" ? { resumeCliSessionId: forkContext.resumeCliSessionId } : {}),
      hidden: true,
      parentSessionId: id,
      slackThreadId: threadId,
      slackThreadAnchorMessageId: anchorMessageId,
      slackThreadAnchorHistoryIndex: anchor.historyIndex,
      slackThreadReadOnly: true,
    });

    child.hidden = true;
    child.parentSessionId = id;
    child.slackThreadId = threadId;
    child.slackThreadAnchorMessageId = anchorMessageId;
    child.slackThreadAnchorHistoryIndex = anchor.historyIndex;
    child.slackThreadReadOnly = true;
    child.noAutoName = true;
    launcher.touchActivity(child.sessionId);

    const childSession = wsBridge.getOrCreateSession(child.sessionId, backend);
    childSession.state.hidden = true;
    childSession.state.slackThreadChild = {
      rootSessionId: id,
      threadId,
      anchorMessageId,
      anchorHistoryIndex: anchor.historyIndex,
      readOnly: true,
      contextStrategy: forkContext.strategy,
    };
    childSession.state.permissionMode = permissionMode;
    childSession.state.cwd = root.state.cwd || rootInfo.cwd;
    childSession.state.model = root.state.model || rootInfo.model || "";
    childSession.state.treeGroupId = root.state.treeGroupId ?? "default";
    childSession.state.memorySessionSpaceSlug = root.state.memorySessionSpaceSlug;
    wsBridge.persistSessionById(child.sessionId);
    sessionNames.setName(child.sessionId, `Thread: ${anchor.preview || anchorMessageId}`);

    const now = Date.now();
    const thread = {
      id: threadId,
      rootSessionId: id,
      childSessionId: child.sessionId,
      anchorMessageId,
      anchorHistoryIndex: anchor.historyIndex,
      anchorPreview: anchor.preview,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      seeded: forkContext.strategy === "native-fork",
      contextStrategy: forkContext.strategy,
      ...(forkContext.strategy === "bounded-replay" ? { contextFallbackReason: forkContext.fallbackReason } : {}),
    };
    root.state.slackThreads = { ...(root.state.slackThreads ?? {}), [threadId]: thread };
    wsBridge.broadcastToSession(id, {
      type: "session_update",
      session: { slackThreads: root.state.slackThreads },
    } as never);
    wsBridge.persistSessionById(id);
    return c.json({ ok: true, thread });
  });

  api.post("/sessions/:id/slack-threads/:threadId/message", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const threadId = c.req.param("threadId");
    const root = wsBridge.getSession(id);
    const rootInfo = launcher.getSession(id);
    if (!root || !rootInfo) return c.json({ error: "Session not found" }, 404);
    if (isLeaderSession(root, rootInfo)) {
      return c.json({ error: "Slack threads are disabled for leader sessions" }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) return c.json({ error: "content is required" }, 400);
    const routed = await wsBridge.routeSlackThreadUserMessage(id, threadId, content, {
      clientMsgId: typeof body.clientMsgId === "string" ? body.clientMsgId : undefined,
    });
    if (!routed.ok) return c.json({ error: routed.error }, 400);
    const thread = root?.state.slackThreads?.[threadId];
    if (thread) wsBridge.syncSlackThreadRecord(id, threadId);
    return c.json({
      ok: true,
      thread: root?.state.slackThreads?.[threadId] ?? thread,
      childSessionId: routed.childSessionId,
    });
  });
}
