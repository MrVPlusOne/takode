import type { Context, Hono } from "hono";
import type { RouteContext } from "./context.js";
import type { BoardRow } from "../session-types.js";
import * as questStore from "../quest-store.js";
import { getTakodeQuestOwnerSessionId } from "../../shared/quest-owner.js";
import { normalizeCommitShas } from "../quest-store-helpers.js";
import type { PortCommand } from "../quest-code-deliveries.js";
import type { QuestmasterTask } from "../quest-types.js";
import { workEvidenceCaller, workEvidenceHost, type WorkEvidenceTargetCaller } from "../work-evidence-replacement.js";
import { projectQuestDelivery, type QuestCodeDelivery, type QuestDeliveryView } from "../../shared/quest-delivery.js";
import { broadcastQuestUpdate } from "./quest-helpers.js";
import { registerWorkDeliveryTargetRoutes } from "./work-delivery-targets.js";
import {
  DeliveryEvidenceError,
  resolveDeliveryTargetApproval,
  splitDeliveryCommits,
} from "../published-delivery-target.js";
import {
  deliveryEvidenceOf,
  findAssignedBoardRowsForWorker,
  hasUnaddressedHumanFeedback,
  onCheckoutMachine,
  resolveActiveWorkPhaseContext,
  resolveWorkEvidenceCaller,
  resolveCurrentWorkFeedback,
} from "./work-evidence-context.js";

export interface WorkDeliveryRoutesDeps {
  launcher: RouteContext["launcher"];
  wsBridge: RouteContext["wsBridge"];
  authenticateTakodeCaller: RouteContext["authenticateTakodeCaller"];
  acquireWorkEvidenceMutationLock: (leaderId: string, questId: string) => (() => void) | null;
}

/** The leader-approved delivery targets a Work evidence request names; none means the inherited target only. */
export function parseDeliveryTargetIds(body: { deliveryTargetIds?: unknown; deliveryTargetId?: unknown }): string[] {
  if (body.deliveryTargetId !== undefined)
    throw new DeliveryEvidenceError("Name approved targets with deliveryTargetIds (a list).", 400);
  const ids = body.deliveryTargetIds;
  if (ids === undefined) return [];
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new DeliveryEvidenceError("deliveryTargetIds requires unique exact approved target IDs.", 400);
  return ids as string[];
}

/**
 * Verify and build every delivery one Work evidence request carries. Each named
 * approval takes its approved commits out of `commitShas` and is verified against
 * its own published repository; the remaining commits are the inherited target's
 * delivery, verified as before (with its port preparation, if any). Nothing is
 * recorded here, so a failure in any repository records none of them.
 */
export async function buildWorkDeliveries(input: {
  questId: string;
  actorSessionId: string;
  phaseOccurrenceId: string;
  caller: WorkEvidenceTargetCaller;
  leaderSessionId: string;
  quest: QuestmasterTask;
  commitShas: string[];
  deliveryTargetIds: string[];
  preparationId?: string;
  /** False when a landing-queue entry carries the inherited target's commits instead. */
  inheritedAllowed?: boolean;
}): Promise<QuestCodeDelivery[]> {
  const existing = deliveryEvidenceOf(input.quest);
  const split = splitDeliveryCommits(input.commitShas, input.deliveryTargetIds, existing.deliveryTargetApprovals);
  // Check every approval and its exact commit set before any Git work, so the specific reason is reported.
  for (const part of split.targets) resolveDeliveryTargetApproval({ ...input, ...part, existing });
  if (split.inherited.length > 0 && input.inheritedAllowed === false)
    throw new DeliveryEvidenceError(
      "With a landing entry, list only the named delivery targets' commits; the entry carries the inherited target's.",
      400,
    );
  if (input.preparationId && split.inherited.length === 0)
    throw new DeliveryEvidenceError(
      "A port preparation belongs to inherited-target commits, and every listed commit belongs to a delivery target.",
      400,
    );
  const caller = await resolveWorkEvidenceCaller(input.caller);
  const scope = {
    questId: input.questId,
    actorSessionId: input.actorSessionId,
    phaseOccurrenceId: input.phaseOccurrenceId,
    caller,
    existing,
    leaderSessionId: input.leaderSessionId,
  };
  const parts = [
    ...(split.inherited.length > 0
      ? [{ commitShas: split.inherited, ...(input.preparationId ? { preparationId: input.preparationId } : {}) }]
      : []),
    ...split.targets,
  ];
  const deliveries: QuestCodeDelivery[] = [];
  for (const part of parts)
    deliveries.push(await onCheckoutMachine(workEvidenceHost(caller), "buildCodeDelivery", { ...scope, ...part }));
  return deliveries;
}

/**
 * A request that names an already recorded delivery must also name every delivery
 * recorded after it in this Work occurrence: a later recording supersedes an earlier
 * one unless both are part of the same multi-repository delivery.
 */
export function laterRecordedDeliveryError(
  quest: QuestmasterTask,
  actorSessionId: string,
  phaseOccurrenceId: string,
  deliveries: QuestCodeDelivery[],
): string | undefined {
  const requested = new Set(deliveries.map((delivery) => delivery.id));
  const recorded = (quest.codeDeliveries ?? []).filter(
    (item) => item.actorSessionId === actorSessionId && item.phaseOccurrenceId === phaseOccurrenceId,
  );
  const first = recorded.findIndex((item) => requested.has(item.id));
  if (first < 0 || recorded.slice(first).every((item) => requested.has(item.id))) return undefined;
  return "This Work occurrence has a later recorded delivery; use its current commits and approved targets (or name them too) before entering Memory.";
}

/** The stored views of the deliveries one request recorded or re-confirmed, in request order. */
export function projectRecordedDeliveries(
  quest: QuestmasterTask,
  deliveries: QuestCodeDelivery[],
): QuestDeliveryView[] {
  return deliveries.map((delivery) =>
    projectQuestDelivery(quest.questId, quest.codeDeliveries?.find((item) => item.id === delivery.id) ?? delivery),
  );
}

/** Tracking changes refs/receipts only; recording uses the same lock as Work -> Memory. */
export function registerWorkDeliveryRoutes(api: Hono, deps: WorkDeliveryRoutesDeps): void {
  registerWorkDeliveryTargetRoutes(api, deps);
  async function resolveWorker(c: Context, questId: string, publication = false, workNote?: number) {
    const auth = deps.authenticateTakodeCaller(c);
    if ("response" in auth) throw new WorkRouteError("Worker authentication required.", 403);
    if (auth.caller.reviewerOf !== undefined || auth.caller.isOrchestrator)
      throw new WorkRouteError("Only the assigned worker may change Work delivery state.", 403);
    if (!/^q-\d+$/.test(questId)) throw new WorkRouteError("Invalid quest ID.", 400);
    const quest = await questStore.getQuest(questId);
    if (!quest || quest.status !== "in_progress" || getTakodeQuestOwnerSessionId(quest) !== auth.callerId) {
      throw new WorkRouteError("Claimed in-progress quest ownership is required.", 403);
    }
    const matches = findAssignedBoardRowsForWorker({ ...deps, workerSessionId: auth.callerId, questId });
    if (matches.length !== 1) throw new WorkRouteError("An unambiguous worker board assignment is required.", 409);
    const match = matches[0]!;
    assertActiveWork(match.row);
    const scope = resolveActiveWorkPhaseContext(match.leaderSessionId, match.row, quest);
    if ("error" in scope) throw new WorkRouteError(scope.error, 409);
    if (publication) {
      if (hasUnaddressedHumanFeedback(quest))
        throw new WorkRouteError("Resolve human feedback before recording accepted delivery.", 409);
      const note = resolveCurrentWorkFeedback({
        quest,
        authorSessionId: auth.callerId,
        activeScope: scope,
        requestedIndex: workNote,
      });
      if ("error" in note) throw new WorkRouteError(note.error, 409);
    }
    return { auth, quest, match, scope };
  }

  api.post("/takode/port/:questId/:action", async (c) => {
    let release: (() => void) | null = null;
    try {
      const questId = c.req.param("questId");
      const action = c.req.param("action");
      const body = await c.req.json();
      const worker = await resolveWorker(c, questId);
      release = deps.acquireWorkEvidenceMutationLock(worker.match.leaderSessionId, questId);
      if (!release) throw new WorkRouteError("Another Work evidence operation is active.", 409);
      const id = typeof body.id === "string" ? body.id : "";
      let command: PortCommand;
      const landingQueue = deps.wsBridge.landingQueue;
      if (action === "prepare") {
        const previousId = typeof body.previousId === "string" ? body.previousId : undefined;
        command = {
          action,
          baseSha: typeof body.baseSha === "string" ? body.baseSha : "",
          groupTips: body.groupTips === undefined ? undefined : normalizeCommitShas(body.groupTips),
          confirmPrivate: body.confirmPrivate === true,
          previousId,
          // A bounced or withdrawn landing-queue entry proves its sealed preparation never landed.
          ...(previousId && (await landingQueue?.attestsUnlanded(previousId, worker.auth.callerId))
            ? { previousUnlanded: true }
            : {}),
        };
      } else if (action === "seal") {
        command = { action, id, commitShas: normalizeCommitShas(body.commitShas) };
      } else if (action === "landed") {
        const workerSha = typeof body.workerSha === "string" ? body.workerSha : "";
        const targetSha = typeof body.targetSha === "string" ? body.targetSha : "";
        const entryId = typeof body.landingEntryId === "string" ? body.landingEntryId : "";
        const attested =
          entryId !== "" &&
          (await landingQueue?.attestsLanding(entryId, worker.auth.callerId, id, workerSha, targetSha)) === true;
        if (entryId && !attested)
          throw new WorkRouteError(
            `Landing entry ${entryId} does not record ${workerSha} landing as ${targetSha}.`,
            409,
          );
        command = { action, id, workerSha, targetSha, ...(attested ? { attested } : {}) };
      } else {
        throw new WorkRouteError("Unknown port action; use prepare, seal, or landed.", 400);
      }
      const input = {
        questId,
        actorSessionId: worker.auth.callerId,
        phaseOccurrenceId: worker.scope.phaseOccurrenceId,
        caller: workEvidenceCaller(worker.auth.caller),
      };
      return c.json(await onCheckoutMachine(worker.auth.caller.hostId, "portCommand", input, command));
    } catch (error) {
      return workError(c, error);
    } finally {
      release?.();
    }
  });

  api.get("/takode/port/:questId/:id", async (c) => {
    try {
      const questId = c.req.param("questId");
      if (!/^q-\d+$/.test(questId)) throw new WorkRouteError("Invalid quest ID.", 400);
      const auth = deps.authenticateTakodeCaller(c);
      if ("response" in auth) return auth.response;
      // The immutable journal's actor/quest/branch/target checks still apply after Work ends.
      const input = {
        questId,
        actorSessionId: auth.callerId,
        phaseOccurrenceId: "inspection",
        caller: workEvidenceCaller(auth.caller),
      };
      const command: PortCommand = { action: "inspect", id: c.req.param("id") };
      return c.json(await onCheckoutMachine(auth.caller.hostId, "portCommand", input, command));
    } catch (error) {
      return workError(c, error);
    }
  });

  api.post("/takode/board/record-work-delivery", async (c) => {
    let release: (() => void) | null = null;
    try {
      const body = await c.req.json();
      const questId = typeof body.questId === "string" ? body.questId : "";
      const workNote = body.workFeedbackIndex;
      const deliveryTargetIds = parseDeliveryTargetIds(body);
      if (body.target !== undefined)
        throw new WorkRouteError("Use leader-approved deliveryTargetIds, not a target override.", 400);
      if (workNote !== undefined && (!Number.isInteger(workNote) || workNote < 0))
        throw new WorkRouteError("Invalid Work note index.", 400);
      const worker = await resolveWorker(c, questId, true, workNote);
      release = deps.acquireWorkEvidenceMutationLock(worker.match.leaderSessionId, questId);
      if (!release) throw new WorkRouteError("Another Work evidence operation is active.", 409);
      const deliveries = await buildWorkDeliveries({
        questId,
        actorSessionId: worker.auth.callerId,
        phaseOccurrenceId: worker.scope.phaseOccurrenceId,
        caller: worker.auth.caller,
        quest: worker.quest,
        leaderSessionId: worker.match.leaderSessionId,
        deliveryTargetIds,
        commitShas: normalizeCommitShas(body.commitShas),
        preparationId: typeof body.preparationId === "string" ? body.preparationId : undefined,
      });
      if (deliveries.length === 0 || deliveries.some((delivery) => delivery.commits.length === 0))
        throw new WorkRouteError("A delivery requires at least one commit.", 400);
      const refreshed = await resolveWorker(c, questId, true, workNote);
      if (
        refreshed.match.leaderSessionId !== worker.match.leaderSessionId ||
        refreshed.scope.phaseOccurrenceId !== worker.scope.phaseOccurrenceId
      ) {
        throw new WorkRouteError("Work assignment changed while verifying delivery.", 409);
      }
      const updated = await questStore.appendQuestCodeDeliveriesForOwner(
        questId,
        { kind: "takode", sessionId: worker.auth.callerId },
        deliveries,
      );
      if (!updated) throw new WorkRouteError("Quest no longer exists.", 409);
      broadcastQuestUpdate(deps.wsBridge, updated);
      return c.json({ questId, deliveries: projectRecordedDeliveries(updated, deliveries) });
    } catch (error) {
      return workError(c, error);
    } finally {
      release?.();
    }
  });
}

function assertActiveWork(row: BoardRow): void {
  if (row.status !== "WORKING" || (row.waitForInput?.length ?? 0) > 0) {
    throw new WorkRouteError("Active Work with no unresolved User Checkpoint is required.", 409);
  }
}

class WorkRouteError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409,
  ) {
    super(message);
  }
}

function workError(c: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : "Work delivery operation failed.";
  if (!(error instanceof WorkRouteError)) console.warn("[work-delivery] Operation rejected:", message);
  return c.json(
    { error: message },
    error instanceof WorkRouteError || error instanceof DeliveryEvidenceError ? error.status : 409,
  );
}
