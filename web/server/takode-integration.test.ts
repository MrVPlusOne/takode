import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

const execSyncMock = vi.hoisted(() => vi.fn(() => "/repo/.git\n"));

vi.mock("node:os", () => ({
  homedir: () => "/home/tester",
}));

vi.mock("node:fs", () => fsMocks);

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

import { ensureTakodeIntegration } from "./takode-integration.js";

describe("ensureTakodeIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execSyncMock.mockReturnValue("/repo/.git\n");
  });

  it("writes a checkout-agnostic shared dispatcher", () => {
    ensureTakodeIntegration("/worktrees/wt-1/web", "server-a");

    const sharedWrite = fsMocks.writeFileSync.mock.calls.find((call) => call[0] === "/home/tester/.companion/bin/takode");
    expect(sharedWrite).toBeDefined();

    const sharedWrapper = String(sharedWrite?.[1] ?? "");
    expect(sharedWrapper).toContain('server_root="$HOME/.companion/bin/servers"');
    expect(sharedWrapper).toContain('server_wrapper="$server_root/$COMPANION_SERVER_ID/takode"');
    expect(sharedWrapper).toContain('echo "takode: multiple server-local wrappers found; set COMPANION_SERVER_ID or run from a launched session" >&2');
    expect(sharedWrapper).not.toContain("/repo/web/bin/takode.ts");
    expect(sharedWrapper).not.toContain("/worktrees/wt-1/web/bin/takode.ts");

    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.companion/bin/servers/server-a/takode",
      expect.stringContaining('exec bun "/worktrees/wt-1/web/bin/takode.ts" "$@"'),
      "utf-8",
    );
  });

  it("keeps shared wrapper semantics identical across different checkout roots while isolating server-local wrappers", () => {
    ensureTakodeIntegration("/checkout-a/web", "server-a");
    ensureTakodeIntegration("/checkout-b/web", "server-b");

    const sharedWrites = fsMocks.writeFileSync.mock.calls.filter((call) => call[0] === "/home/tester/.companion/bin/takode");
    expect(sharedWrites).toHaveLength(2);
    expect(sharedWrites[0]?.[1]).toBe(sharedWrites[1]?.[1]);

    const sharedWrapper = String(sharedWrites[1]?.[1] ?? "");
    expect(sharedWrapper).not.toContain("/repo/web/bin/takode.ts");
    expect(sharedWrapper).not.toContain("/checkout-a/web/bin/takode.ts");
    expect(sharedWrapper).not.toContain("/checkout-b/web/bin/takode.ts");

    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.companion/bin/servers/server-a/takode",
      expect.stringContaining('exec bun "/checkout-a/web/bin/takode.ts" "$@"'),
      "utf-8",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
      "/home/tester/.companion/bin/servers/server-b/takode",
      expect.stringContaining('exec bun "/checkout-b/web/bin/takode.ts" "$@"'),
      "utf-8",
    );
  });
});
