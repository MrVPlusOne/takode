import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProgrammaticHistoryFollowUp } from "./session-types.js";

/**
 * What a session hears when work Takode itself interrupted (to restart the
 * server or update a host's node) is continued. Claude Code reports a tool call
 * cut off by an interrupt as rejected by the user and tells the model to stop
 * and wait, so the message says the user rejected nothing and that the call may
 * already have done part of its work.
 */
export const RESTART_CONTINUE_MESSAGE =
  "Continue. Takode restarted or updated itself, which interrupted your work; the interruption was not a response to anything you did. " +
  "If it cut off a tool call, that call's result may say the user rejected or interrupted it, but the user did not. " +
  "The call may have partly run, so check what it already did before redoing any of it.";

const FILE_NAME = "restart-continuations.json";
const HOST_UPDATE_REQUEST_FILE_NAME = "restart-host-updates.json";

export interface RestartContinuationTarget {
  sessionId: string;
  label: string;
}

export interface RestartContinuationPlan {
  version: 1;
  operationId: string;
  createdAt: number;
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
    takodeHerdBatch?: undefined,
    threadRoute?: undefined,
    options?: { deliveryContent?: string; historyFollowUps?: ProgrammaticHistoryFollowUp[] },
  ) => "sent" | "queued" | "paused_queued" | "dropped" | "no_session";
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
    sessions: dedupeTargets(options.sessions),
  };
}

export async function saveRestartContinuationPlan(directory: string, plan: RestartContinuationPlan): Promise<void> {
  await mkdir(dirname(filePath(directory)), { recursive: true });
  await writeFile(filePath(directory), JSON.stringify(plan, null, 2), "utf-8");
}

export async function clearRestartContinuationPlan(directory: string): Promise<void> {
  await deletePlanFile(directory);
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

  // This server words the continuation; a message saved by an older server is ignored.
  for (const target of plan.sessions) {
    const status = sendRestartContinuation(bridge, target.sessionId, plan.operationId);
    if (status === "sent") result.sent += 1;
    else if (status === "queued" || status === "paused_queued") result.queued += 1;
    else if (status === "dropped") result.dropped += 1;
    else result.noSession += 1;
  }

  return result;
}

/** Tell a session whose turn a restart interrupted to go on. */
export function sendRestartContinuation(
  bridge: RestartContinuationBridge,
  sessionId: string,
  operationId: string,
  message = RESTART_CONTINUE_MESSAGE,
): ReturnType<RestartContinuationBridge["injectUserMessage"]> {
  const agentSource = { sessionId: `system:restart-continuation:${operationId}`, sessionLabel: "System" };
  return bridge.injectUserMessage(sessionId, message, agentSource, undefined, undefined, {
    deliveryContent: message,
    historyFollowUps: [],
  });
}

/**
 * How long a Restart Server request stays valid for the server it starts. A
 * later start, say by hand after the restart failed, is no user's restart.
 */
export const HOST_UPDATE_REQUEST_MAX_AGE_MS = 10 * 60_000;

/**
 * Record that the user asked for this restart, so the next server updates
 * its auto-updating hosts right away instead of when they are idle.
 */
export async function saveHostUpdateRequest(directory: string, now = Date.now()): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(hostUpdateRequestPath(directory), JSON.stringify({ version: 1, requestedAt: now }), "utf-8");
}

/** Whether the user's Restart Server started this server; reads the request once and removes it. */
export async function takeHostUpdateRequest(directory: string, now = Date.now()): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(hostUpdateRequestPath(directory), "utf-8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  await unlink(hostUpdateRequestPath(directory)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  try {
    const { requestedAt } = JSON.parse(raw) as { requestedAt?: unknown };
    return (
      typeof requestedAt === "number" && now - requestedAt >= 0 && now - requestedAt <= HOST_UPDATE_REQUEST_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

function hostUpdateRequestPath(directory: string): string {
  return join(directory, HOST_UPDATE_REQUEST_FILE_NAME);
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
