import type { Context, Hono } from "hono";
import * as sessionNames from "../session-names.js";
import { getSettings } from "../settings-manager.js";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";
import type {
  BackendType,
  SideChatFallbackMode,
  SideChatFallbackReasonCode,
  SideChatNativeEligibility,
  SideChatPreflight,
} from "../session-types.js";
import { computeCodexSideChatForkPlan, createSideChatId, findRootAssistantAnchor } from "../side-chat-branches.js";

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

export function registerSessionSideChatRoutes(
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

  type NativeForkPlan = SideChatNativeEligibility & {
    rollbackTurns?: number;
    upToMessageId?: string;
  };

  const codexPlanReasonCode = (reason: string): SideChatFallbackReasonCode => {
    if (reason === "anchor is not in a Codex turn segment") return "codex-anchor-not-in-turn";
    if (reason === "anchor turn is not complete") return "codex-anchor-turn-incomplete";
    if (reason === "anchor is not the final assistant message in its Codex turn") {
      return "codex-anchor-not-final-assistant";
    }
    if (reason === "later Codex turn is still incomplete") return "codex-later-turn-incomplete";
    return "codex-anchor-not-in-turn";
  };

  const fallbackFromNative = (native: NativeForkPlan): SideChatPreflight["fallback"] => ({
    available: !native.eligible,
    requiresConfirmation: true,
    ...(native.reason ? { reason: native.reason } : {}),
    ...(native.reasonCode ? { reasonCode: native.reasonCode } : {}),
  });

  const evaluateNativeForkEligibility = (
    backend: BackendType,
    root: NonNullable<ReturnType<WsBridge["getSession"]>>,
    rootInfo: NonNullable<ReturnType<CliLauncher["getSession"]>>,
    anchor: NonNullable<ReturnType<typeof findRootAssistantAnchor>>,
  ): NativeForkPlan => {
    if (backend === "codex") {
      const plan = computeCodexSideChatForkPlan(root.messageHistory, anchor.message.message.id);
      if (!plan.ok) {
        return {
          eligible: false,
          reason: `Codex native fork skipped: ${plan.reason}`,
          reasonCode: codexPlanReasonCode(plan.reason),
        };
      }
      const adapter = root.codexAdapter;
      if (!adapter?.forkThread || !adapter.isConnected?.()) {
        return {
          eligible: false,
          reason: "Codex native fork unavailable: root adapter is not connected",
          reasonCode: "codex-adapter-disconnected",
        };
      }
      return { eligible: true, rollbackTurns: plan.rollbackTurns };
    }
    if (backend === "claude-sdk") {
      const upToMessageId = anchor.message.uuid || anchor.message.message.id;
      if (!rootInfo.cliSessionId || !upToMessageId) {
        return {
          eligible: false,
          reason: "Claude native fork unavailable: missing session or anchor id",
          reasonCode: "claude-missing-session-or-anchor",
        };
      }
      return { eligible: true, upToMessageId };
    }
    return {
      eligible: false,
      reason: `Native fork unavailable for backend ${backend}`,
      reasonCode: "unsupported-backend",
    };
  };

  const buildPreflight = (
    backend: BackendType,
    root: NonNullable<ReturnType<WsBridge["getSession"]>>,
    rootInfo: NonNullable<ReturnType<CliLauncher["getSession"]>>,
    anchorMessageId: string,
  ): SideChatPreflight | { ok: false; status: number; error: string; reasonCode?: SideChatFallbackReasonCode } => {
    if (root.state.slackThreadChild || rootInfo.hidden) {
      return {
        ok: false,
        status: 400,
        error: "Side Chats can only start from a root session",
        reasonCode: "invalid-root-session",
      };
    }
    if (isLeaderSession(root, rootInfo)) {
      return {
        ok: false,
        status: 403,
        error: "Side Chats are disabled for leader sessions",
        reasonCode: "leader-session",
      };
    }
    const existing = Object.values(root.state.slackThreads ?? {}).find(
      (thread) => thread.anchorMessageId === anchorMessageId,
    );
    const anchor = findRootAssistantAnchor(root.messageHistory, anchorMessageId);
    if (!anchor) {
      return { ok: false, status: 400, error: "Anchor must be a root assistant message", reasonCode: "invalid-anchor" };
    }
    const native = evaluateNativeForkEligibility(backend, root, rootInfo, anchor);
    return {
      ok: true,
      anchorMessageId,
      backendType: backend,
      ...(existing ? { existingSideChat: root.state.slackThreads?.[existing.id] ?? existing } : {}),
      native: {
        eligible: native.eligible,
        ...(native.reason ? { reason: native.reason } : {}),
        ...(native.reasonCode ? { reasonCode: native.reasonCode } : {}),
      },
      fallback: fallbackFromNative(native),
    };
  };

  const tryCreateNativeFork = async (
    backend: BackendType,
    root: NonNullable<ReturnType<WsBridge["getSession"]>>,
    rootInfo: NonNullable<ReturnType<CliLauncher["getSession"]>>,
    anchor: NonNullable<ReturnType<typeof findRootAssistantAnchor>>,
  ): Promise<
    | { strategy: "native-fork"; resumeCliSessionId: string }
    | { strategy: "bounded-replay"; fallbackReason: string; fallbackReasonCode: SideChatFallbackReasonCode }
  > => {
    const title = `Side Chat: ${anchor.preview || anchor.message.message.id}`;
    const native = evaluateNativeForkEligibility(backend, root, rootInfo, anchor);
    if (!native.eligible) {
      return {
        strategy: "bounded-replay",
        fallbackReason: native.reason ?? "Native fork unavailable",
        fallbackReasonCode: native.reasonCode ?? "unsupported-backend",
      };
    }
    if (backend === "codex") {
      const forkThread = root.codexAdapter?.forkThread;
      if (!forkThread) {
        return {
          strategy: "bounded-replay",
          fallbackReason: "Codex native fork unavailable: root adapter is not connected",
          fallbackReasonCode: "codex-adapter-disconnected",
        };
      }
      try {
        const forkedThreadId = await forkThread({ rollbackTurns: native.rollbackTurns || undefined });
        return { strategy: "native-fork", resumeCliSessionId: forkedThreadId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const rollbackFailed = message.toLowerCase().includes("rollback");
        return {
          strategy: "bounded-replay",
          fallbackReason: `Codex native ${rollbackFailed ? "rollback" : "fork"} failed: ${message}`,
          fallbackReasonCode: rollbackFailed ? "codex-rollback-failed" : "codex-fork-failed",
        };
      }
    }
    if (backend === "claude-sdk") {
      const parentSessionId = rootInfo.cliSessionId;
      const upToMessageId = native.upToMessageId;
      if (!parentSessionId || !upToMessageId) {
        return {
          strategy: "bounded-replay",
          fallbackReason: "Claude native fork unavailable: missing session or anchor id",
          fallbackReasonCode: "claude-missing-session-or-anchor",
        };
      }
      try {
        const forked = await forkClaudeSession(parentSessionId, {
          dir: root.state.cwd || rootInfo.cwd,
          upToMessageId,
          title,
        });
        return { strategy: "native-fork", resumeCliSessionId: forked.sessionId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          strategy: "bounded-replay",
          fallbackReason: `Claude native fork failed: ${message}`,
          fallbackReasonCode: "claude-fork-failed",
        };
      }
    }
    return {
      strategy: "bounded-replay",
      fallbackReason: `Native fork unavailable for backend ${backend}`,
      fallbackReasonCode: "unsupported-backend",
    };
  };

  const handleCreateSideChat = async (c: Context) => {
    const rawId = c.req.param("id");
    const id = rawId ? resolveId(rawId) : null;
    if (!id) return c.json({ error: "Session not found" }, 404);
    const root = wsBridge.getSession(id);
    const rootInfo = launcher.getSession(id);
    if (!root || !rootInfo) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const anchorMessageId = typeof body.anchorMessageId === "string" ? body.anchorMessageId.trim() : "";
    if (!anchorMessageId) return c.json({ error: "anchorMessageId is required" }, 400);
    if (root.state.slackThreadChild || rootInfo.hidden) {
      return c.json({ error: "Side Chats can only start from a root session" }, 400);
    }
    if (isLeaderSession(root, rootInfo)) {
      return c.json({ error: "Side Chats are disabled for leader sessions" }, 403);
    }
    const fallbackMode =
      body.fallbackMode === "allow-bounded-replay" || body.allowFallbackReplay === true
        ? ("allow-bounded-replay" satisfies SideChatFallbackMode)
        : ("native-only" satisfies SideChatFallbackMode);

    const existing = Object.values(root.state.slackThreads ?? {}).find(
      (thread) => thread.anchorMessageId === anchorMessageId,
    );
    if (existing) {
      wsBridge.syncSideChatRecord(id, existing.id);
      const sideChat = root.state.slackThreads?.[existing.id] ?? existing;
      return c.json({ ok: true, sideChat, thread: sideChat });
    }

    const anchor = findRootAssistantAnchor(root.messageHistory, anchorMessageId);
    if (!anchor) return c.json({ error: "Anchor must be a root assistant message" }, 400);

    const backend = (rootInfo.backendType || root.state.backend_type || "claude") as BackendType;
    const preflight = buildPreflight(backend, root, rootInfo, anchorMessageId);
    if (!preflight.ok) {
      return c.json({ error: preflight.error, reasonCode: preflight.reasonCode }, preflight.status as never);
    }
    if (!preflight.native.eligible && fallbackMode !== "allow-bounded-replay") {
      return c.json(
        {
          error: preflight.native.reason ?? "Native fork unavailable",
          reasonCode: preflight.native.reasonCode,
          preflight,
        },
        409,
      );
    }

    const sideChatId = createSideChatId();
    const binarySettings = getSettings();
    const permissionMode = backend === "codex" ? rootInfo.permissionMode || "codex-default" : "default";
    const forkContext = await tryCreateNativeFork(backend, root, rootInfo, anchor);
    if (forkContext.strategy === "bounded-replay" && fallbackMode !== "allow-bounded-replay") {
      return c.json(
        {
          error: forkContext.fallbackReason,
          reasonCode: forkContext.fallbackReasonCode,
          preflight: {
            ...preflight,
            native: {
              eligible: false,
              reason: forkContext.fallbackReason,
              reasonCode: forkContext.fallbackReasonCode,
            },
            fallback: {
              available: true,
              requiresConfirmation: true,
              reason: forkContext.fallbackReason,
              reasonCode: forkContext.fallbackReasonCode,
            },
          },
        },
        409,
      );
    }
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
      sideChatId,
      sideChatAnchorMessageId: anchorMessageId,
      sideChatAnchorHistoryIndex: anchor.historyIndex,
      sideChatReadOnly: true,
    });

    child.hidden = true;
    child.parentSessionId = id;
    child.slackThreadId = sideChatId;
    child.slackThreadAnchorMessageId = anchorMessageId;
    child.slackThreadAnchorHistoryIndex = anchor.historyIndex;
    child.slackThreadReadOnly = true;
    child.noAutoName = true;
    launcher.touchActivity(child.sessionId);

    const childSession = wsBridge.getOrCreateSession(child.sessionId, backend);
    childSession.state.hidden = true;
    childSession.state.slackThreadChild = {
      rootSessionId: id,
      threadId: sideChatId,
      anchorMessageId,
      anchorHistoryIndex: anchor.historyIndex,
      readOnly: true,
      contextStrategy: forkContext.strategy,
      ...(forkContext.strategy === "bounded-replay"
        ? {
            contextFallbackReasonCode: forkContext.fallbackReasonCode,
            contextFallbackReason: forkContext.fallbackReason,
          }
        : {}),
    };
    childSession.state.permissionMode = permissionMode;
    childSession.state.cwd = root.state.cwd || rootInfo.cwd;
    childSession.state.model = root.state.model || rootInfo.model || "";
    childSession.state.treeGroupId = root.state.treeGroupId ?? "default";
    childSession.state.memorySessionSpaceSlug = root.state.memorySessionSpaceSlug;
    wsBridge.persistSessionById(child.sessionId);
    sessionNames.setName(child.sessionId, `Side Chat: ${anchor.preview || anchorMessageId}`);

    const now = Date.now();
    const sideChat = {
      id: sideChatId,
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
      ...(forkContext.strategy === "bounded-replay"
        ? {
            contextFallbackReasonCode: forkContext.fallbackReasonCode,
            contextFallbackReason: forkContext.fallbackReason,
          }
        : {}),
    };
    root.state.slackThreads = { ...(root.state.slackThreads ?? {}), [sideChatId]: sideChat };
    wsBridge.broadcastToSession(id, {
      type: "session_update",
      session: { slackThreads: root.state.slackThreads },
    } as never);
    wsBridge.persistSessionById(id);
    return c.json({ ok: true, sideChat, thread: sideChat });
  };

  const handlePreflightSideChat = async (c: Context) => {
    const rawId = c.req.param("id");
    const id = rawId ? resolveId(rawId) : null;
    if (!id) return c.json({ error: "Session not found" }, 404);
    const root = wsBridge.getSession(id);
    const rootInfo = launcher.getSession(id);
    if (!root || !rootInfo) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const anchorMessageId = typeof body.anchorMessageId === "string" ? body.anchorMessageId.trim() : "";
    if (!anchorMessageId) return c.json({ error: "anchorMessageId is required" }, 400);
    const backend = (rootInfo.backendType || root.state.backend_type || "claude") as BackendType;
    const preflight = buildPreflight(backend, root, rootInfo, anchorMessageId);
    if (!preflight.ok)
      return c.json({ error: preflight.error, reasonCode: preflight.reasonCode }, preflight.status as never);
    return c.json(preflight);
  };

  api.post("/sessions/:id/side-chats/preflight", handlePreflightSideChat);
  api.post("/sessions/:id/side-chats", handleCreateSideChat);
  api.post("/sessions/:id/slack-threads", handleCreateSideChat);

  const handleSideChatMessage = async (c: Context) => {
    const rawId = c.req.param("id");
    const id = rawId ? resolveId(rawId) : null;
    if (!id) return c.json({ error: "Session not found" }, 404);
    const sideChatId = c.req.param("sideChatId") || c.req.param("threadId");
    if (!sideChatId) return c.json({ error: "Side Chat not found" }, 404);
    const root = wsBridge.getSession(id);
    const rootInfo = launcher.getSession(id);
    if (!root || !rootInfo) return c.json({ error: "Session not found" }, 404);
    if (isLeaderSession(root, rootInfo)) {
      return c.json({ error: "Side Chats are disabled for leader sessions" }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) return c.json({ error: "content is required" }, 400);
    const routed = await wsBridge.routeSideChatUserMessage(id, sideChatId, content, {
      clientMsgId: typeof body.clientMsgId === "string" ? body.clientMsgId : undefined,
    });
    if (!routed.ok) return c.json({ error: routed.error }, 400);
    const sideChat = root?.state.slackThreads?.[sideChatId];
    if (sideChat) wsBridge.syncSideChatRecord(id, sideChatId);
    return c.json({
      ok: true,
      sideChat: root?.state.slackThreads?.[sideChatId] ?? sideChat,
      thread: root?.state.slackThreads?.[sideChatId] ?? sideChat,
      childSessionId: routed.childSessionId,
    });
  };

  api.post("/sessions/:id/side-chats/:sideChatId/message", handleSideChatMessage);
  api.post("/sessions/:id/slack-threads/:threadId/message", handleSideChatMessage);
}
