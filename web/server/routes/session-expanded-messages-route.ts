import type { Hono } from "hono";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";

/** Expansions kept per session; the oldest are dropped (shown collapsed again) beyond this. */
export const MAX_EXPANDED_MESSAGES = 500;

export interface SessionExpandedMessagesRouteDeps {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  resolveId: (idOrNum: string) => string | null;
}

/**
 * Expanding or collapsing a message's long content (a report, a long user message) is session
 * state: it is kept on the server and sent to every browser, so a reload or another device
 * shows the same messages expanded. Repeating the current state saves nothing but sends the state
 * again.
 */
export function registerSessionExpandedMessagesRoute(api: Hono, deps: SessionExpandedMessagesRouteDeps): void {
  const { launcher, wsBridge, resolveId } = deps;

  api.put("/sessions/:id/expanded-messages/:messageId", async (c) => {
    const sessionId = resolveId(c.req.param("id"));
    if (!sessionId || !launcher.getSession(sessionId)) return c.json({ error: "Session not found" }, 404);
    const bridgeSession = wsBridge.getSession(sessionId);
    if (!bridgeSession) return c.json({ error: "Session not found in bridge" }, 404);

    const body = await c.req.json().catch(() => ({}));
    if (typeof body.expanded !== "boolean") return c.json({ error: "expanded must be a boolean" }, 400);
    const messageId = decodeURIComponent(c.req.param("messageId"));
    const current = bridgeSession.state.expandedMessages ?? {};
    if (Boolean(current[messageId]) === body.expanded) {
      // Nothing changes, but the asking browser shows otherwise, so its copy is out of date:
      // send the state again, or its toggle would seem to do nothing.
      wsBridge.broadcastToSession(sessionId, {
        type: "session_update",
        session: { expandedMessages: current },
      } as never);
      return c.json({ ok: true, expandedMessages: current });
    }
    if (body.expanded && !bridgeSession.messageHistory.some((message) => expandableMessageId(message) === messageId)) {
      return c.json({ error: "Message has no expandable content" }, 400);
    }

    const expandedMessages = { ...current };
    if (body.expanded) expandedMessages[messageId] = Date.now();
    else delete expandedMessages[messageId];
    bridgeSession.state.expandedMessages = keepNewestExpansions(expandedMessages);
    wsBridge.persistSessionById(sessionId);
    wsBridge.broadcastToSession(sessionId, {
      type: "session_update",
      session: { expandedMessages: bridgeSession.state.expandedMessages },
    } as never);
    return c.json({ ok: true, expandedMessages: bridgeSession.state.expandedMessages });
  });
}

/** The stable ID of a history entry that can show collapsed content, if it is one. */
function expandableMessageId(message: BrowserIncomingMessage): string | undefined {
  if (message.type === "markdown_report" || message.type === "user_message") {
    return typeof message.id === "string" ? message.id : undefined;
  }
  return undefined;
}

function keepNewestExpansions(expanded: Record<string, number>): Record<string, number> {
  const entries = Object.entries(expanded);
  if (entries.length <= MAX_EXPANDED_MESSAGES) return expanded;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_EXPANDED_MESSAGES));
}
