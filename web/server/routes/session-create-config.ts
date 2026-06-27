import type { LaunchOptions } from "../cli-launcher.js";
import type { ContainerInfo } from "../container-manager.js";
import type { RouteContext } from "./context.js";
import type { WorktreeSessionInfo } from "./session-worktree-create.js";

export type CreationProgressStatus = "in_progress" | "done" | "error";

export type EmitCreationProgress = (
  step: import("../session-types.js").CreationStepId,
  label: string,
  status: CreationProgressStatus,
  detail?: string,
) => Promise<void>;

export interface SessionConfig {
  launchOptions: LaunchOptions;
  initialModeState: ReturnType<RouteContext["resolveInitialModeState"]>;
  initialCwd: string;
  isAssistantMode: boolean;
  isOrchestrator: boolean;
  envSlug?: string;
  createdBy?: unknown;
  noAutoName?: boolean;
  fixedName?: string;
  reviewerOf?: number;
  treeGroupId?: string;
  treeGroupExplicitlyRequested: boolean;
  worktreeInfo?: WorktreeSessionInfo;
  containerInfo?: ContainerInfo;
  resumeCliSessionId?: string;
  memorySessionSpaceSlug: string;
}
