import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";

/** Build an adapter without starting a Claude process. */
function createIdleAdapter(): ClaudeSdkAdapter {
  const initialize = vi.spyOn(ClaudeSdkAdapter.prototype as any, "initialize").mockResolvedValue(undefined);
  const adapter = new ClaudeSdkAdapter("sdk-session", { cwd: "/test" });
  initialize.mockRestore();
  return adapter;
}

describe("ClaudeSdkAdapter permission requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the SDK's tool-use ID, agent and description on the permission request", () => {
    // The SDK spells these `toolUseID`/`agentID`; losing them would detach the
    // request from its tool block and break per-tool denial bookkeeping.
    const adapter = createIdleAdapter();
    const emitted: any[] = [];
    adapter.onBrowserMessage((msg) => emitted.push(msg));

    void (adapter as any).handleCanUseTool(
      "Bash",
      { command: "ls" },
      {
        signal: new AbortController().signal,
        toolUseID: "toolu_123",
        agentID: "agent-7",
        description: "List files",
      },
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe("permission_request");
    expect(emitted[0].request).toMatchObject({
      tool_name: "Bash",
      tool_use_id: "toolu_123",
      agent_id: "agent-7",
      description: "List files",
    });
  });

  it("tells the bridge when Claude withdraws a pending permission request", async () => {
    const adapter = createIdleAdapter();
    const emitted: any[] = [];
    adapter.onBrowserMessage((msg) => emitted.push(msg));
    const abort = new AbortController();

    const decision = (adapter as any).handleCanUseTool(
      "Bash",
      { command: "ls" },
      { signal: abort.signal, toolUseID: "toolu_456" },
    );
    const requestId = emitted[0].request.request_id;
    abort.abort();

    await expect(decision).resolves.toEqual({ behavior: "deny", message: "Permission request aborted" });
    expect(emitted[1]).toEqual({ type: "control_cancel_request", request_id: requestId });
  });
  it("forwards permission mode changes to the running Claude process", () => {
    // Claude's own mode decides which tool calls reach canUseTool at all:
    // Full access never asks and Auto lets Claude's classifier approve safe
    // actions itself. A server-only mode change would leave the process in its
    // old mode, so the adapter must forward it, including the "auto" mode.
    const adapter = createIdleAdapter();
    const setPermissionMode = vi.fn().mockResolvedValue(undefined);
    (adapter as any).connected = true;
    (adapter as any).sdkQuery = { setPermissionMode };
    (adapter as any).prompts = { push: vi.fn(), end: vi.fn() };

    expect(adapter.sendBrowserMessage({ type: "set_permission_mode", mode: "auto" })).toBe(true);
    expect(adapter.sendBrowserMessage({ type: "set_permission_mode", mode: "default" })).toBe(true);

    expect(setPermissionMode.mock.calls).toEqual([["auto"], ["default"]]);
  });
});
