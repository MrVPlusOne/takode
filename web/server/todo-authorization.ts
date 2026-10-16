import type { Context } from "hono";
import type { TodoActor, TodoMutationProvenance, TodoUserMessageProvenance } from "../shared/todo-types.js";
import type { RouteContext } from "./routes/context.js";
import { hashTodoAuthorizationContent } from "./todo-store.js";

/** Longest standing-approval citation or to-do source kept with a change. */
export const MAX_CITATION_LENGTH = 500;

export type TodoAuthorizationResult =
  | { ok: true; provenance: TodoMutationProvenance }
  | { ok: false; response: Response };

function callerActor(
  auth: Exclude<ReturnType<RouteContext["authenticateCompanionCallerOptional"]>, null | { response: Response }>,
): TodoActor {
  const label = auth.caller.name?.trim() || auth.caller.sessionNum?.toString() || auth.callerId.slice(0, 8);
  if (auth.caller.cronJobId) {
    return {
      kind: "workflow",
      sessionId: auth.callerId,
      workflowId: auth.caller.cronJobId,
      label: auth.caller.cronJobName?.trim() || label,
    };
  }
  return { kind: "session", sessionId: auth.callerId, label };
}

function directUserMessageProvenance(
  ctx: RouteContext,
  callerId: string,
  historyIndex: unknown,
): TodoUserMessageProvenance | null {
  if (typeof historyIndex !== "number" || !Number.isInteger(historyIndex) || historyIndex < 0) return null;
  const session = ctx.wsBridge.getSession(callerId);
  const message = session?.messageHistory[historyIndex];
  if (!message || message.type !== "user_message" || message.agentSource) return null;
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (!content) return null;
  return {
    sessionId: callerId,
    historyIndex,
    ...(message.id ? { messageId: message.id } : {}),
    timestamp: typeof message.timestamp === "number" ? message.timestamp : 0,
    contentHash: hashTodoAuthorizationContent(content),
    ...(message.threadKey ? { threadKey: message.threadKey } : {}),
    ...(message.questId ? { questId: message.questId } : {}),
  };
}

/**
 * Decide whether the caller may make a to-do change, and record how it was authorized.
 *
 * Browser UI requests are the user's own. An agent may make a change when the user approved it in
 * this session (`authorizedBy`, the index of their reply), when it cites a written standing approval
 * (`standingApproval`, recorded as given; Takode cannot check it), or when the change is low-risk.
 * Everything else is refused: the default is fail-closed.
 */
export async function authorizeTodoMutation(
  c: Context,
  ctx: RouteContext,
  options: {
    authorizedBy?: unknown;
    standingApproval?: unknown;
    /** The change cannot make the user lose track of something, so an agent may make it on its own judgment. */
    lowRisk?: boolean;
  },
): Promise<TodoAuthorizationResult> {
  const auth = ctx.authenticateCompanionCallerOptional(c);
  if (auth && "response" in auth) return { ok: false, response: auth.response };
  const now = Date.now();

  // Browser UI requests intentionally omit session auth headers. Their mutation
  // response and the global invalidation are both server-authored; the browser
  // never applies an optimistic durable mutation.
  if (auth === null) {
    return {
      ok: true,
      provenance: {
        actor: { kind: "user", label: "User" },
        authorization: { kind: "ui" },
        at: now,
      },
    };
  }

  if (options.authorizedBy !== undefined) {
    const userMessage = directUserMessageProvenance(ctx, auth.callerId, options.authorizedBy);
    if (!userMessage) {
      return {
        ok: false,
        response: c.json(
          {
            error:
              "--authorized-by must reference a direct human user message in this same session; injected or missing messages cannot authorize a to-do mutation",
          },
          403,
        ),
      };
    }
    return {
      ok: true,
      provenance: {
        actor: callerActor(auth),
        authorization: { kind: "direct_message", userMessage },
        at: now,
      },
    };
  }

  if (options.standingApproval !== undefined) {
    const standingApproval = typeof options.standingApproval === "string" ? options.standingApproval.trim() : "";
    if (!standingApproval || standingApproval.length > MAX_CITATION_LENGTH) {
      return {
        ok: false,
        response: c.json(
          {
            error: `--standing-approval must cite where the approval is written and what it allows, in at most ${MAX_CITATION_LENGTH} characters`,
          },
          400,
        ),
      };
    }
    return {
      ok: true,
      provenance: {
        actor: callerActor(auth),
        authorization: { kind: "standing_approval", standingApproval },
        at: now,
      },
    };
  }

  if (options.lowRisk) {
    return { ok: true, provenance: { actor: callerActor(auth), authorization: { kind: "agent_direct" }, at: now } };
  }

  return {
    ok: false,
    response: c.json(
      {
        error:
          "This to-do change needs the user's approval. Describe it to the user, linking the to-do, and rerun with --authorized-by <their reply's message index>, or cite a written standing approval that covers it with --standing-approval.",
      },
      403,
    ),
  };
}

/**
 * An edit that only adds text: the title stays and every existing line is kept, in order. Adding
 * context to a to-do is low-risk; rewording or removing what the user wrote is not.
 */
export function isAdditiveTodoEdit(before: string, after: string): boolean {
  const lines = (markdown: string) =>
    markdown
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter(Boolean);
  const kept = lines(before);
  const next = lines(after);
  if (next[0] !== kept[0]) return false;
  let matched = 0;
  for (const line of next) if (line === kept[matched]) matched += 1;
  return matched === kept.length;
}
