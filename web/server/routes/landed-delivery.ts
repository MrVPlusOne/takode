import * as questStore from "../quest-store.js";
import type { LandedDeliveryInput } from "../landing-quest-handoff.js";
import { workEvidenceCaller, workEvidenceHost, type WorkEvidenceTargetCaller } from "../work-evidence-replacement.js";
import { broadcastQuestUpdate } from "./quest-helpers.js";
import type { RouteContext } from "./context.js";
import { deliveryEvidenceOf, onCheckoutMachine } from "./work-evidence-context.js";

/**
 * Record a quest's landed commits as the delivery of the Work occurrence that
 * submitted them, on the worker's target machine, as `work-to-memory --commits`
 * does for synced commits: the base checkout is fast-forwarded, port receipts
 * are recorded with the queue's attestation, and the delivery is built and
 * attached to the quest.
 */
export async function recordLandedDelivery(
  deps: { launcher: RouteContext["launcher"]; wsBridge: RouteContext["wsBridge"] },
  input: LandedDeliveryInput,
): Promise<{ deliveryId: string; note?: string }> {
  const session = deps.launcher.getSession(input.workerSessionId);
  if (!session) throw new Error(`the worker session ${input.workerSessionId} is unknown`);
  const caller = workEvidenceCaller(session as WorkEvidenceTargetCaller);
  const host = workEvidenceHost(caller);
  const target = caller.worktreePortTarget;
  const checkoutPath = target?.worktreePath || target?.repoRoot;
  if (!checkoutPath) throw new Error("the worker session has no port target checkout");
  await onCheckoutMachine(host, "syncBaseCheckoutToRemote", { checkoutPath, branch: input.branch, tip: input.tip });

  const commitShas = input.mapping.map((commit) => commit.target);
  const scope = {
    questId: input.questId,
    actorSessionId: input.workerSessionId,
    phaseOccurrenceId: input.workPhaseOccurrenceId,
    caller,
  };
  let preparationId = input.preparationId;
  let note: string | undefined;
  if (preparationId) {
    try {
      for (const commit of input.mapping)
        await onCheckoutMachine(caller.hostId, "portCommand", scope, {
          action: "landed",
          id: preparationId,
          workerSha: commit.source,
          targetSha: commit.target,
          attested: true,
        });
    } catch (error) {
      // The receipts live in the worker's worktree; without it the commits still count as delivered.
      note = `recorded without their port-tracking review provenance (${error instanceof Error ? error.message : String(error)})`;
      preparationId = undefined;
    }
  }
  const quest = await questStore.getQuest(input.questId);
  if (!quest) throw new Error(`quest ${input.questId} is gone`);
  const delivery = await onCheckoutMachine(host, "buildCodeDelivery", {
    ...scope,
    commitShas,
    existing: deliveryEvidenceOf(quest),
    leaderSessionId: input.leaderSessionId,
    ...(preparationId ? { preparationId } : {}),
  });
  const updated = await questStore.appendQuestCodeCommitEvidenceForOwner(
    input.questId,
    { kind: "takode", sessionId: input.workerSessionId },
    delivery.commits.map((commit) => commit.sha),
    delivery,
  );
  if (!updated) throw new Error(`quest ${input.questId} is gone`);
  broadcastQuestUpdate(deps.wsBridge, updated);
  return { deliveryId: delivery.id, ...(note ? { note } : {}) };
}
