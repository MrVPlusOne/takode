import type { Context } from "hono";
import type {
  TodoActor,
  TodoGrantAction,
  TodoMutationProvenance,
  TodoPrincipal,
  TodoUserMessageProvenance,
} from "../shared/todo-types.js";
import type { RouteContext } from "./routes/context.js";
import { hashTodoAuthorizationContent, type TodoStore } from "./todo-store.js";

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

export function principalsForTodoCaller(
  auth: Exclude<ReturnType<RouteContext["authenticateCompanionCallerOptional"]>, null | { response: Response }>,
): TodoPrincipal[] {
  const principals: TodoPrincipal[] = [
    {
      kind: "session",
      id: auth.callerId,
      label: auth.caller.name?.trim() || auth.caller.sessionNum?.toString() || auth.callerId.slice(0, 8),
    },
  ];
  if (auth.caller.cronJobId) {
    principals.push({
      kind: "cron",
      id: auth.caller.cronJobId,
      label: auth.caller.cronJobName?.trim() || auth.caller.cronJobId,
    });
  }
  return principals;
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

export async function authorizeTodoMutation(
  c: Context,
  ctx: RouteContext,
  store: TodoStore,
  options: {
    action: TodoGrantAction;
    categoryIds: string[];
    authorizedBy?: unknown;
    allowGrant?: boolean;
    /**
     * The change cannot make the user lose track of something, so an agent may make it on its own
     * judgment. Everything else needs the user's approval (`--authorized-by` naming their reply to
     * the agent's description of the change) or a matching grant; new to-dos can also be proposed.
     */
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
            canPropose: true,
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

  if (options.allowGrant !== false) {
    const grant = await store.matchingGrant(principalsForTodoCaller(auth), options.action, options.categoryIds);
    if (grant) {
      return {
        ok: true,
        provenance: {
          actor: callerActor(auth),
          authorization: { kind: "grant", grantId: grant.id },
          at: now,
        },
      };
    }
  }

  if (options.lowRisk) {
    return { ok: true, provenance: { actor: callerActor(auth), authorization: { kind: "agent_direct" }, at: now } };
  }

  const canPropose = options.action === "item:add";
  return {
    ok: false,
    response: c.json(
      {
        error: canPropose
          ? "Adding a to-do needs the user's approval. Propose it with `takode todo propose add`, or describe it to the user and rerun with --authorized-by <their reply's message index>."
          : "This to-do change needs the user's approval. Describe it to the user, linking the to-do, and rerun with --authorized-by <their reply's message index>.",
        canPropose,
        requiredAction: options.action,
        requiredCategoryIds: options.categoryIds,
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

export function todoProposalActor(
  auth: Exclude<ReturnType<RouteContext["authenticateTakodeCaller"]>, { response: Response }>,
): TodoActor {
  return callerActor(auth);
}
