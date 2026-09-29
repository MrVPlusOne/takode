import type { LaunchOptions } from "./cli-launcher-options.js";

export type CodexSandboxMode = NonNullable<LaunchOptions["codexSandbox"]>;
type CodexApprovalPolicy = "never" | "untrusted" | "on-request" | "on-failure";
type CodexPolicyOptions = Pick<
  LaunchOptions,
  | "model"
  | "permissionMode"
  | "askPermission"
  | "codexSandbox"
  | "codexInternetAccess"
  | "codexReasoningEffort"
  | "codexMultiAgentVersion"
>;

/** Resolve the shared process policy for every managed Codex launch and relaunch. */
export function resolveCodexLaunchPolicy(options: CodexPolicyOptions): {
  args: string[];
  sandboxMode: CodexSandboxMode | undefined;
} {
  // Process overrides beat saved/project config without modifying standalone
  // preferences or memory data. Generation/recall controls alone do not stop
  // consolidation of existing inputs; the master feature must also be disabled.
  const args = [
    "-c",
    "features.memories=false",
    "-c",
    "memories.generate_memories=false",
    "-c",
    "memories.use_memories=false",
  ];
  if (options.codexMultiAgentVersion) {
    args.push(options.codexMultiAgentVersion === "v2" ? "--enable" : "--disable", "multi_agent_v2");
  }
  args.push("-c", `tools.webSearch=${options.codexInternetAccess === true ? "true" : "false"}`);
  if (options.model) args.push("-c", `model=${options.model}`);
  if (options.codexReasoningEffort) args.push("-c", `model_reasoning_effort=${options.codexReasoningEffort}`);
  if (options.permissionMode === "codex-auto-review") args.push("-c", "approvals_reviewer=auto_review");
  const approvalPolicy = mapCodexApprovalPolicy(options.permissionMode, options.askPermission);
  const sandboxMode = resolveCodexSandbox(options.permissionMode, options.codexSandbox);
  if (approvalPolicy) args.push("-a", approvalPolicy);
  if (sandboxMode) args.push("-s", sandboxMode);
  return { args, sandboxMode };
}

function mapCodexApprovalPolicy(permissionMode?: string, askPermission?: boolean): CodexApprovalPolicy | undefined {
  switch (permissionMode) {
    case "codex-custom":
      return undefined;
    case "codex-default":
      return "on-request";
    case "codex-auto-review":
      return "on-request";
    case "codex-full-access":
      return "never";
  }

  const effectiveAskPermission =
    typeof askPermission === "boolean" ? askPermission : permissionMode !== "bypassPermissions";
  if (!effectiveAskPermission) return "never";
  return permissionMode === "bypassPermissions" ? "never" : "untrusted";
}

function resolveCodexSandbox(permissionMode?: string, requested?: CodexSandboxMode): CodexSandboxMode | undefined {
  if (permissionMode === "codex-custom") return undefined;
  if (requested) return requested;
  switch (permissionMode) {
    case "codex-auto-review":
      return "workspace-write";
    case "codex-full-access":
    case "bypassPermissions":
      return "danger-full-access";
    case "codex-default":
    default:
      return "workspace-write";
  }
}
