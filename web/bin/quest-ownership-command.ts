import { claimQuest } from "../server/quest-store.js";
import type { QuestmasterTask } from "../server/quest-types.js";
import { getName } from "../server/session-names.js";
import { formatSessionLabel } from "./quest-format.js";

export type QuestOwnershipCommandDeps = {
  validateFlags: (allowed: string[]) => void;
  positional: (index: number) => string | undefined;
  option: (name: string) => string | undefined;
  flag: (name: string) => boolean;
  currentSessionId: string | undefined;
  companionPort: string | undefined;
  companionAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  notifyServer: () => Promise<void>;
  printHumanFeedbackWarning: (quest: QuestmasterTask) => void;
  jsonOutput: boolean;
  out: (value: unknown) => void;
  die: (message: string) => never;
};

export async function runClaimCommand(deps: QuestOwnershipCommandDeps): Promise<void> {
  deps.validateFlags(["session", "force", "reason", "json"]);
  if (process.env.TAKODE_ROLE === "orchestrator") {
    deps.die("Leader sessions cannot claim quests. Dispatch to a worker instead.");
  }
  const id = deps.positional(0);
  if (!id) deps.die("Usage: quest claim <questId> [--session <sid>] [--force --reason <text>]");
  const explicitSession = deps.option("session");
  const sessionId = explicitSession || deps.currentSessionId;
  const force = deps.flag("force");
  const reason = deps.option("reason")?.trim();
  if (!sessionId && !deps.companionPort) {
    deps.die("No session identity. Pass --session <id> or run from a Companion session.");
  }
  if (force) {
    if (!deps.currentSessionId) deps.die("Force claim requires Companion session auth.");
    if (explicitSession && explicitSession !== deps.currentSessionId) {
      deps.die("Force claim cannot target another session. Run it from the worker that should own the quest.");
    }
    if (!reason) deps.die("Force claim requires --reason <text>.");
    if (!deps.companionPort) deps.die("Force claim requires the Companion server.");
  }

  if (deps.companionPort) {
    await claimViaServer(deps, id, sessionId, force, reason);
    return;
  }
  await claimViaFilesystem(deps, id, sessionId);
}

export async function runReassignCommand(deps: QuestOwnershipCommandDeps): Promise<void> {
  deps.validateFlags(["session", "reason", "json"]);
  const id = deps.positional(0);
  if (!id) deps.die("Usage: quest reassign <questId> --session <worker> --reason <text>");
  const sessionId = deps.option("session")?.trim();
  if (!sessionId) deps.die("quest reassign requires --session <worker>.");
  const reason = deps.option("reason")?.trim();
  if (!reason) deps.die("quest reassign requires --reason <text>.");
  if (!deps.companionPort) deps.die("quest reassign requires the Companion server.");

  try {
    const res = await fetch(`http://localhost:${deps.companionPort}/api/quests/${encodeURIComponent(id)}/reassign`, {
      method: "POST",
      headers: deps.companionAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sessionId, reason }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      deps.die((err as { error: string }).error || res.statusText);
    }
    const quest = (await res.json()) as QuestmasterTask;
    if (deps.jsonOutput) deps.out(quest);
    else
      console.log(`Reassigned ${quest.questId} "${quest.title}" to ${formatOwner(sessionId, deps.currentSessionId)}`);
  } catch (e) {
    deps.die(`Failed to reassign via Companion server: ${(e as Error).message}`);
  }
}

async function claimViaServer(
  deps: QuestOwnershipCommandDeps,
  id: string,
  sessionId: string | undefined,
  force: boolean,
  reason: string | undefined,
): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${deps.companionPort}/api/quests/${encodeURIComponent(id)}/claim`, {
      method: "POST",
      headers: deps.companionAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...(sessionId ? { sessionId } : {}),
        ...(force ? { force: true, reason } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      deps.die((err as { error: string }).error || res.statusText);
    }
    const quest = (await res.json()) as QuestmasterTask;
    printClaimedQuest(deps, quest, sessionId);
  } catch (e) {
    deps.die(`Failed to claim via Companion server: ${(e as Error).message}`);
  }
}

async function claimViaFilesystem(
  deps: QuestOwnershipCommandDeps,
  id: string,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) deps.die("No session identity. Pass --session <id> or run from a Companion session.");
  try {
    const quest = await claimQuest(id, sessionId);
    if (!quest) deps.die(`Quest ${id} not found`);
    await deps.notifyServer();
    printClaimedQuest(deps, quest, sessionId);
  } catch (e) {
    deps.die((e as Error).message);
  }
}

function printClaimedQuest(deps: QuestOwnershipCommandDeps, quest: QuestmasterTask, requestedSessionId?: string): void {
  if (deps.jsonOutput) {
    deps.out(quest);
    return;
  }
  const owner = "sessionId" in quest && typeof quest.sessionId === "string" ? quest.sessionId : requestedSessionId;
  console.log(
    `Claimed ${quest.questId} "${quest.title}" for session ${formatOwner(owner || "unknown", deps.currentSessionId)}`,
  );
  deps.printHumanFeedbackWarning(quest);
}

function formatOwner(sessionId: string, currentSessionId: string | undefined): string {
  return formatSessionLabel(sessionId, undefined, { currentSessionId, getSessionName: getName });
}
