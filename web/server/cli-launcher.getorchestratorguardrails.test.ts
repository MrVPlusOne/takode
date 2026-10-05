import { describe, expect, it } from "vitest";
import { CliLauncher } from "./cli-launcher.js";
import { getOrchestratorGuardrails } from "./cli-launcher-instructions.js";
import { normalizePersistedBackendType } from "./session-types.js";

describe("CliLauncher.getOrchestratorGuardrails", () => {
  it.each([
    undefined,
    "claude",
    "claude-sdk",
    "codex",
  ] as const)("forwards the %s backend to the canonical builder", (stored) => {
    // Stored sessions may still carry the retired "claude" type; they load as Claude SDK.
    const backend = stored === undefined ? undefined : normalizePersistedBackendType(stored);
    // This stateless facade must preserve backend selection. Calling it on the
    // prototype avoids unrelated process and filesystem fixtures.
    expect(CliLauncher.prototype.getOrchestratorGuardrails(backend)).toBe(getOrchestratorGuardrails(backend));
  });
});
