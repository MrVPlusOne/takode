import { claimQuest } from "../server/quest-store.js";
import type { QuestInvocationProvenance, QuestmasterTask } from "../server/quest-types.js";
import type { QuestOwnerRef } from "../shared/quest-owner.js";
import { getName } from "../server/session-names.js";
import { formatSessionLabel } from "./quest-format.js";
import type { QuestServerClient } from "./quest-server-client.js";

export type QuestOwnershipCommandDeps = {
  validateFlags: (allowed: string[]) => void;
  positional: (index: number) => string | undefined;
  option: (name: string) => string | undefined;
  flag: (name: string) => boolean;
  currentSessionId: string | undefined;
  codexOwner?: QuestOwnerRef;
  codexProvenance?: QuestInvocationProvenance;
  companionPort: string | undefined;
  questServer: QuestServerClient;
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
  if (deps.codexOwner && explicitSession && explicitSession !== deps.codexOwner.sessionId) {
    deps.die("Direct Codex quest claims cannot target another session.");
  }
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

  // Only the server's own Codex Quest command worker writes the store directly.
  if (deps.codexOwner) {
    await claimViaFilesystem(deps, id, sessionId);
    return;
  }
  await claimViaServer(deps, id, sessionId, force, reason);
}

export async function runReassignCommand(deps: QuestOwnershipCommandDeps): Promise<void> {
  deps.validateFlags(["session", "reason", "json"]);
  const id = deps.positional(0);
  if (!id) deps.die("Usage: quest reassign <questId> --session <worker> --reason <text>");
  const sessionId = deps.option("session")?.trim();
  if (!sessionId) deps.die("quest reassign requires --session <worker>.");
  const reason = deps.option("reason")?.trim();
  if (!reason) deps.die("quest reassign requires --reason <text>.");
  if (deps.codexOwner) deps.die("Direct Codex tasks cannot reassign Takode quest ownership.");
  if (!deps.companionPort) deps.die("quest reassign requires the Companion server.");

  const { value: quest } = await deps.questServer.request<QuestmasterTask>(
    "POST",
    `/quests/${encodeURIComponent(id)}/reassign`,
    { sessionId, reason },
  );
  if (deps.jsonOutput) deps.out(quest);
  else console.log(`Reassigned ${quest.questId} "${quest.title}" to ${formatOwner(sessionId, deps.currentSessionId)}`);
}

async function claimViaServer(
  deps: QuestOwnershipCommandDeps,
  id: string,
  sessionId: string | undefined,
  force: boolean,
  reason: string | undefined,
): Promise<void> {
  const { value: quest } = await deps.questServer.request<QuestmasterTask>(
    "POST",
    `/quests/${encodeURIComponent(id)}/claim`,
    {
      ...(sessionId ? { sessionId } : {}),
      ...(force ? { force: true, reason } : {}),
    },
  );
  printClaimedQuest(deps, quest, sessionId);
}

async function claimViaFilesystem(
  deps: QuestOwnershipCommandDeps,
  id: string,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) deps.die("No session identity. Pass --session <id> or run from a Companion session.");
  try {
    const quest = await claimQuest(id, sessionId, {
      ...(deps.codexOwner ? { ownerKind: "codex" as const } : {}),
      ...(deps.codexProvenance ? { provenance: deps.codexProvenance } : {}),
    });
    if (!quest) deps.die(`Quest ${id} not found`);
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
