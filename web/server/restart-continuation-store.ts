import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const RESTART_CONTINUE_MESSAGE = "Continue.";

const FILE_NAME = "restart-continuations.json";

export interface RestartContinuationTarget {
  sessionId: string;
  label: string;
}

export interface RestartContinuationPlan {
  version: 1;
  operationId: string;
  createdAt: number;
  message: string;
  sessions: RestartContinuationTarget[];
}

export interface RestartContinuationResumeResult {
  plan: RestartContinuationPlan | null;
  sent: number;
  queued: number;
  dropped: number;
  noSession: number;
}

interface RestartContinuationBridge {
  injectUserMessage: (
    sessionId: string,
    content: string,
    agentSource?: { sessionId: string; sessionLabel?: string },
  ) => "sent" | "queued" | "dropped" | "no_session";
}

export function buildRestartContinuationPlan(options: {
  operationId: string;
  sessions: RestartContinuationTarget[];
  now?: number;
}): RestartContinuationPlan {
  return {
    version: 1,
    operationId: options.operationId,
    createdAt: options.now ?? Date.now(),
    message: RESTART_CONTINUE_MESSAGE,
    sessions: dedupeTargets(options.sessions),
  };
}

export async function saveRestartContinuationPlan(directory: string, plan: RestartContinuationPlan): Promise<void> {
  await mkdir(dirname(filePath(directory)), { recursive: true });
  await writeFile(filePath(directory), JSON.stringify(plan, null, 2), "utf-8");
}

export async function drainRestartContinuationPlan(directory: string): Promise<RestartContinuationPlan | null> {
  let raw: string;
  try {
    raw = await readFile(filePath(directory), "utf-8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  await deletePlanFile(directory);
  return normalizePlan(JSON.parse(raw));
}

export async function resumeRestartContinuations(
  directory: string,
  bridge: RestartContinuationBridge,
): Promise<RestartContinuationResumeResult> {
  const result: RestartContinuationResumeResult = {
    plan: null,
    sent: 0,
    queued: 0,
    dropped: 0,
    noSession: 0,
  };
  const plan = await drainRestartContinuationPlan(directory);
  result.plan = plan;
  if (!plan) return result;

  const agentSource = {
    sessionId: `system:restart-continuation:${plan.operationId}`,
    sessionLabel: "System",
  };
  for (const target of plan.sessions) {
    const status = bridge.injectUserMessage(target.sessionId, plan.message, agentSource);
    if (status === "sent") result.sent += 1;
    else if (status === "queued") result.queued += 1;
    else if (status === "dropped") result.dropped += 1;
    else result.noSession += 1;
  }

  return result;
}

function filePath(directory: string): string {
  return join(directory, FILE_NAME);
}

function dedupeTargets(targets: RestartContinuationTarget[]): RestartContinuationTarget[] {
  const byId = new Map<string, RestartContinuationTarget>();
  for (const target of targets) {
    if (!target.sessionId || byId.has(target.sessionId)) continue;
    byId.set(target.sessionId, target);
  }
  return [...byId.values()];
}

async function deletePlanFile(directory: string): Promise<void> {
  try {
    await unlink(filePath(directory));
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function normalizePlan(raw: unknown): RestartContinuationPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<RestartContinuationPlan>;
  if (data.version !== 1) return null;
  if (typeof data.operationId !== "string" || !data.operationId) return null;
  if (!Array.isArray(data.sessions)) return null;

  return {
    version: 1,
    operationId: data.operationId,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    message: typeof data.message === "string" && data.message.trim() ? data.message : RESTART_CONTINUE_MESSAGE,
    sessions: dedupeTargets(
      data.sessions.flatMap((session) => {
        if (!session || typeof session !== "object") return [];
        const target = session as Partial<RestartContinuationTarget>;
        if (typeof target.sessionId !== "string" || !target.sessionId) return [];
        return [
          {
            sessionId: target.sessionId,
            label: typeof target.label === "string" && target.label ? target.label : target.sessionId.slice(0, 8),
          },
        ];
      }),
    ),
  };
}
