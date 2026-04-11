/**
 * Tests for the permission pipeline's takode event emission behavior (q-205).
 *
 * Validates that emitTakodePermissionRequest is called for ALL pipeline outcomes
 * that create a pending permission (both queued_for_llm_auto_approval and
 * pending_human), ensuring herded workers' permissions are always visible
 * to the leader session.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handlePermissionRequest,
  type PermissionPipelineSession,
  type PermissionPipelineDeps,
} from "./permission-pipeline.js";
import type { AutoApprovalConfig } from "../auto-approval-store.js";

// Mock the async dependencies so we can control the pipeline
vi.mock("../auto-approver.js", () => ({
  shouldAttemptAutoApproval: vi.fn(),
}));

vi.mock("./settings-rule-matcher.js", () => ({
  shouldSettingsRuleApprove: vi.fn(),
}));

import { shouldAttemptAutoApproval } from "../auto-approver.js";
import { shouldSettingsRuleApprove } from "./settings-rule-matcher.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_AUTO_APPROVAL_CONFIG: AutoApprovalConfig = {
  enabled: true,
  criteria: "approve safe operations",
  projectPath: "/tmp/test",
  label: "test",
  slug: "test-slug",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeSession(overrides: Partial<PermissionPipelineSession> = {}): PermissionPipelineSession {
  return {
    id: "session-1",
    backendType: "claude",
    state: { permissionMode: "default", cwd: "/tmp/test" },
    pendingPermissions: new Map(),
    ...overrides,
  };
}

function makeDeps(): PermissionPipelineDeps<PermissionPipelineSession> {
  return {
    onSessionActivityStateChanged: vi.fn(),
    broadcastPermissionRequest: vi.fn(),
    persistSession: vi.fn(),
    setAttentionAction: vi.fn(),
    emitTakodePermissionRequest: vi.fn(),
    schedulePermissionNotification: vi.fn(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("permission pipeline takode event emission (q-205)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: settings rules don't match, auto-approval not configured
    vi.mocked(shouldSettingsRuleApprove).mockResolvedValue(null);
    vi.mocked(shouldAttemptAutoApproval).mockResolvedValue(null);
  });

  it("emits takode permission_request when permission is pending_human (no auto-approval)", async () => {
    // When LLM auto-approval is not available, the pipeline should emit the
    // takode event so the herd leader has visibility.
    const session = makeSession();
    const deps = makeDeps();

    const result = await handlePermissionRequest(
      session,
      {
        request_id: "req-1",
        tool_name: "Bash",
        input: { command: "echo test" },
        tool_use_id: "tu-1",
      },
      "claude-ws",
      deps,
      { activityReason: "permission_request" },
    );

    expect(result.kind).toBe("pending_human");
    expect(deps.emitTakodePermissionRequest).toHaveBeenCalledTimes(1);
    expect(deps.emitTakodePermissionRequest).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        request_id: "req-1",
        tool_name: "Bash",
      }),
    );
  });

  it("emits takode permission_request when permission is queued for LLM auto-approval (SDK sessions)", async () => {
    // Regression test (q-205): previously, queued_for_llm_auto_approval did NOT
    // emit the takode event, leaving the herd leader blind to permissions being
    // evaluated by the LLM auto-approver.
    // Note: LLM auto-approval requires isClaudeFamily(backend), which is true for
    // "claude-sdk" but NOT for "claude-ws". SDK sessions also go through the
    // settings rule tier first, so we mock that to return no match.
    vi.mocked(shouldAttemptAutoApproval).mockResolvedValue(MOCK_AUTO_APPROVAL_CONFIG);

    const session = makeSession({ backendType: "claude-sdk" });
    const deps = makeDeps();

    const result = await handlePermissionRequest(
      session,
      {
        request_id: "req-2",
        tool_name: "Edit",
        input: { file_path: "/tmp/test/foo.ts", old_string: "a", new_string: "b" },
        tool_use_id: "tu-2",
      },
      "claude-sdk",
      deps,
      { activityReason: "permission_request" },
    );

    expect(result.kind).toBe("queued_for_llm_auto_approval");
    // Key assertion: emitTakodePermissionRequest MUST be called even for
    // queued_for_llm_auto_approval so the herd leader has visibility
    expect(deps.emitTakodePermissionRequest).toHaveBeenCalledTimes(1);
    expect(deps.emitTakodePermissionRequest).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        request_id: "req-2",
        tool_name: "Edit",
      }),
    );
  });

  it("does NOT emit takode permission_request for mode_auto_approved (bypassPermissions)", () => {
    // Mode auto-approved permissions are resolved instantly and never need
    // leader attention -- no takode event should be emitted.
    const session = makeSession({
      state: { permissionMode: "bypassPermissions", cwd: "/tmp/test" },
    });
    const deps = makeDeps();

    const result = handlePermissionRequest(
      session,
      {
        request_id: "req-3",
        tool_name: "Bash",
        input: { command: "echo test" },
        tool_use_id: "tu-3",
      },
      "claude-ws",
      deps,
      { activityReason: "permission_request" },
    );

    // mode_auto_approved returns synchronously (not a Promise)
    expect(result).not.toBeInstanceOf(Promise);
    expect((result as { kind: string }).kind).toBe("mode_auto_approved");
    expect(deps.emitTakodePermissionRequest).not.toHaveBeenCalled();
  });

  it("schedules notification only for pending_human, not for queued_for_llm", async () => {
    // Notifications should only fire when a human needs to act. When the LLM
    // is evaluating, the notification is premature.
    vi.mocked(shouldAttemptAutoApproval).mockResolvedValue(MOCK_AUTO_APPROVAL_CONFIG);

    const session = makeSession({ backendType: "claude-sdk" });
    const deps = makeDeps();

    const result = await handlePermissionRequest(
      session,
      {
        request_id: "req-4",
        tool_name: "Bash",
        input: { command: "ls" },
        tool_use_id: "tu-4",
      },
      "claude-sdk",
      deps,
      { activityReason: "permission_request" },
    );

    expect(result.kind).toBe("queued_for_llm_auto_approval");
    // schedulePermissionNotification should NOT be called for LLM-queued permissions
    expect(deps.schedulePermissionNotification).not.toHaveBeenCalled();
    // But emitTakodePermissionRequest MUST still be called (q-205 fix)
    expect(deps.emitTakodePermissionRequest).toHaveBeenCalledTimes(1);
  });

  it("does NOT emit takode permission_request for settings_rule_approved", async () => {
    // Settings-rule-approved permissions are resolved instantly (like mode
    // auto-approve) and never need leader attention. The pipeline should
    // return settings_rule_approved without emitting a takode event.
    vi.mocked(shouldSettingsRuleApprove).mockResolvedValue("Bash(mkdir *)");

    const session = makeSession({ backendType: "claude-sdk" });
    const deps = makeDeps();

    const result = await handlePermissionRequest(
      session,
      {
        request_id: "req-5",
        tool_name: "Bash",
        input: { command: "mkdir -p /tmp/test-dir" },
        tool_use_id: "tu-5",
      },
      "claude-sdk",
      deps,
      { activityReason: "permission_request" },
    );

    expect(result.kind).toBe("settings_rule_approved");
    expect(deps.emitTakodePermissionRequest).not.toHaveBeenCalled();
  });
});
