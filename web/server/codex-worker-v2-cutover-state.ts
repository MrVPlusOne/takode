import { createHash } from "node:crypto";
import type { CodexMultiAgentVersion } from "../shared/codex-multi-agent-version.js";
import type { CodexWorkerFreshThreadHandoffBundle } from "./codex-worker-v2-handoff.js";
import type {
  CodexWorkerRolloutPreservationSnapshot,
  CodexWorkerV2DurableCutoverState,
} from "./codex-worker-v2-rollout.js";

export type CodexWorkerV2CutoverState = CodexWorkerV2DurableCutoverState;

export function createCodexWorkerV2CutoverState(args: {
  activation: "now" | "next_resume";
  originalCliSessionId?: string;
  originalSelectedVersion?: CodexMultiAgentVersion;
  requestedAt: number;
  handoff: CodexWorkerFreshThreadHandoffBundle;
  preservation: CodexWorkerRolloutPreservationSnapshot;
}): CodexWorkerV2CutoverState {
  return {
    schemaVersion: 1,
    cutoverId: args.handoff.cutoverId,
    status: "prepared",
    requestedAt: args.requestedAt,
    updatedAt: args.requestedAt,
    activation: args.activation,
    targetVersion: "v2",
    rollbackVersion: "v1",
    originalCliSessionId: args.originalCliSessionId ?? null,
    originalSelectedVersion: args.originalSelectedVersion ?? null,
    oneShotExtraInstructions: args.handoff.extraInstructions,
    handoffFingerprint: hash(args.handoff.extraInstructions),
    preservation: {
      historyCount: args.preservation.history.length,
      historyPrefixFingerprint: hashCodexWorkerPreservedItems(args.preservation.history),
      pendingInputs: args.preservation.pendingInputs.map((item) => ({ ...item })),
      pendingTurns: args.preservation.pendingTurns.map((item) => ({ ...item })),
      pendingInputFingerprint: hashCodexWorkerPreservedItems(args.preservation.pendingInputs),
      pendingTurnFingerprint: hashCodexWorkerPreservedItems(args.preservation.pendingTurns),
      launchConfigFingerprint: args.preservation.launchConfigFingerprint,
      questFingerprint: args.preservation.questFingerprint,
      worktreeFingerprint: args.preservation.worktreeFingerprint,
      recoveryFingerprint: args.preservation.recoveryFingerprint,
      sessionIdentityFingerprint: args.preservation.sessionIdentityFingerprint,
    },
  };
}

export function hashCodexWorkerPreservedItems(items: readonly { id: string; fingerprint: string }[]): string {
  return hash(items.map((item) => `${item.id}:${item.fingerprint}`).join("\n"));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
