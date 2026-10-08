import { prepareWorktreeSessionArtifacts } from "../cli-launcher-worktree.js";
import { listDirectories } from "../directory-listing.js";
import { readCommitDetails } from "../git-commit-reader.js";
import { ensureWorktreeAsync, getRepoInfoAsync, listBranchesAsync } from "../git-utils.js";
import { recreateSessionCheckout } from "../migration.js";
import { verifyReview } from "../port-tracking.js";
import { verifyPublishedDeliveryTarget } from "../published-delivery-target.js";
import { buildCodeDelivery, runPortCommand } from "../quest-code-deliveries.js";
import { readDeliveryRange, resolveDeliveryRange } from "../quest-delivery-range.js";
import { assessWorktreeCleanupSafety, removeWorktreeCheckout } from "../routes/worktree-cleanup.js";
import { verifyReplacementWorkEvidence } from "../work-evidence-replacement.js";
import { requestOnHost } from "./session-machine.js";

/**
 * Operations a session's machine performs on its own repos and files. For a
 * session on this machine they run here; for a session on a remote host the
 * coordinator asks that host's `takode node` to run the same code there.
 * Arguments and results must survive JSON.
 */
const operations = {
  listDirectories: (path: string | undefined, showHidden: boolean) => listDirectories(path, showHidden),
  repoInfo: (cwd: string) => getRepoInfoAsync(cwd),
  listBranches: (repoRoot: string, options: Parameters<typeof listBranchesAsync>[1]) =>
    listBranchesAsync(repoRoot, options),
  ensureWorktree: (repoRoot: string, branch: string, options: Parameters<typeof ensureWorktreeAsync>[2]) =>
    ensureWorktreeAsync(repoRoot, branch, options),
  prepareWorktreeArtifacts: (options: Parameters<typeof prepareWorktreeSessionArtifacts>[0]) =>
    prepareWorktreeSessionArtifacts(options),
  worktreeCleanupSafety: (target: Parameters<typeof assessWorktreeCleanupSafety>[0]) =>
    assessWorktreeCleanupSafety(target),
  removeWorktreeCheckout: (...args: Parameters<typeof removeWorktreeCheckout>) => removeWorktreeCheckout(...args),
  recreateSessionCheckout: (input: Parameters<typeof recreateSessionCheckout>[0]) => recreateSessionCheckout(input),
  // Delivery evidence: Git checks and reads of the checkout a Work delivery names.
  verifyPublishedDeliveryTarget: (...args: Parameters<typeof verifyPublishedDeliveryTarget>) =>
    verifyPublishedDeliveryTarget(...args),
  verifyWorkEvidence: (...args: Parameters<typeof verifyReplacementWorkEvidence>) =>
    verifyReplacementWorkEvidence(...args),
  buildCodeDelivery: (input: Parameters<typeof buildCodeDelivery>[0]) => buildCodeDelivery(input),
  portCommand: (...args: Parameters<typeof runPortCommand>) => runPortCommand(...args),
  verifyReview: (...args: Parameters<typeof verifyReview>) => verifyReview(...args),
  readCommitDetails: (...args: Parameters<typeof readCommitDetails>) => readCommitDetails(...args),
  resolveDeliveryRange: (...args: Parameters<typeof resolveDeliveryRange>) => resolveDeliveryRange(...args),
  readDeliveryRange: (...args: Parameters<typeof readDeliveryRange>) => readDeliveryRange(...args),
};

export type HostOperations = typeof operations;
export type HostOperationName = keyof HostOperations;

/** Git and worktree operations can take a while on a large repo. */
const OPERATION_TIMEOUT_MS = 120_000;

/** Run an operation on the session's machine: the remote host `hostId`, or this one when absent. */
export async function onMachine<K extends HostOperationName>(
  hostId: string | null | undefined,
  name: K,
  ...args: Parameters<HostOperations[K]>
): Promise<Awaited<ReturnType<HostOperations[K]>>> {
  type Result = Awaited<ReturnType<HostOperations[K]>>;
  if (!hostId) {
    const run = operations[name] as unknown as (...input: Parameters<HostOperations[K]>) => Promise<Result>;
    return run(...args);
  }
  const response = await requestOnHost(hostId, { kind: "operation", name, args }, OPERATION_TIMEOUT_MS);
  return response.result as Result;
}

/** Host side: run an operation the coordinator asked for. */
export async function performHostOperation(name: string, args: unknown[]): Promise<unknown> {
  if (!Object.hasOwn(operations, name)) throw new Error(`Unknown host operation: ${name}`);
  const run = operations[name as HostOperationName] as (...input: unknown[]) => Promise<unknown>;
  // JSON has no `undefined`; normalize so both sides see the same result.
  return (await run(...args)) ?? null;
}
