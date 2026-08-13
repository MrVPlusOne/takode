import { describe, expect, it, vi } from "vitest";
import { setBackendState } from "./session-registry-controller.js";

describe("Codex provider retry terminal backend state", () => {
  it.each([
    "broken",
    "recovery_suppressed",
  ] as const)("clears retry progress when backend becomes %s", (backendState) => {
    const broadcastSessionUpdate = vi.fn();
    const session = {
      state: {
        backend_state: "recovering",
        backend_error: null,
        codex_provider_retry: {
          family: "model_backend_stream_error",
          ownerId: "input-1",
          attempt: 1,
          maxAttempts: 2,
          startedAt: 10,
        },
      },
    } as any;

    setBackendState(session, backendState, "terminal failure", { broadcastSessionUpdate });

    expect(session.state.codex_provider_retry).toBeNull();
    expect(broadcastSessionUpdate).toHaveBeenCalledWith(session, {
      backend_state: backendState,
      backend_error: "terminal failure",
      codex_provider_retry: null,
    });
  });
});
