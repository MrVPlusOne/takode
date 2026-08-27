import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { CodexSidecarRegistry } from "./codex-sidecar-auth.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodexSidecarRegistry", () => {
  it("creates a mode-0600 per-install capability file in an isolated directory", async () => {
    // Capability discovery must be persistent for the stdio MCP, while this test
    // proves the implementation never reaches the user's ~/.companion data.
    const root = mkdtempSync(join(tmpdir(), "takode-sidecar-capability-"));
    roots.push(root);
    const capabilityPath = join(root, "capability.json");
    const registry = new CodexSidecarRegistry({ port: 4567, serverId: "server-test", capabilityPath });

    const initialized = await registry.initialize();
    const persisted = JSON.parse(readFileSync(capabilityPath, "utf-8"));

    expect(persisted).toEqual(initialized);
    expect(initialized.baseUrl).toBe("http://127.0.0.1:4567/api/integrations/codex");
    expect(registry.verifyCapability(initialized.capability)).toBe(true);
    expect(registry.verifyCapability("wrong")).toBe(false);
    expect(statSync(capabilityPath).mode & 0o777).toBe(0o600);
  });

  it("consumes and expires opaque bindings without changing actor identity", async () => {
    // Bindings are single-use convenience handles, not an alternative identity source.
    let now = 100;
    const registry = new CodexSidecarRegistry({
      port: 4567,
      serverId: "server-test",
      capability: "capability",
      bindingTtlMs: 50,
      now: () => now,
    });
    await registry.initialize();
    const binding = registry.bind({
      kind: "codex_session",
      sessionId: "thr-1",
      turnId: "turn-1",
      toolUseId: "tool-1",
      cwd: "/repo",
    });

    expect(registry.resolveBinding(binding.id)?.actor).toEqual({
      kind: "codex_session",
      sessionId: "thr-1",
      turnId: "turn-1",
      toolUseId: "tool-1",
      cwd: "/repo",
    });
    expect(registry.resolveBinding(binding.id)).toBeNull();
    const expiring = registry.bind({ kind: "codex_session", sessionId: "thr-2" });
    now = 151;
    registry.bind({ kind: "codex_session", sessionId: "thr-3" });
    expect(registry.resolveBinding(expiring.id)).toBeNull();
  });
});
