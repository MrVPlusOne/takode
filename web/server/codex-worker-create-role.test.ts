import { describe, expect, it } from "vitest";
import { resolveCodexMultiAgentVersionForCreate } from "./codex-worker-create-role.js";

const leader = { isOrchestrator: true };
const worker = { isOrchestrator: false };
const archivedLeader = { isOrchestrator: true, archived: true };
const hiddenLeader = { isOrchestrator: true, hidden: true, publicSessionNumber: false };

function resolveCreator(createdBy: string) {
  if (createdBy === "leader-1") return leader;
  if (createdBy === "worker-1") return worker;
  if (createdBy === "leader-archived") return archivedLeader;
  if (createdBy === "leader-hidden") return hiddenLeader;
  return undefined;
}

describe("resolveCodexMultiAgentVersionForCreate", () => {
  it("selects V2 only for a normal Codex worker created by a server-resolved leader", () => {
    // `createdBy` is only authoritative after the server resolves it to an
    // orchestrator; arbitrary client text must not turn a manual session into a worker.
    expect(resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-1" }, "codex", resolveCreator)).toBe("v2");
    expect(resolveCodexMultiAgentVersionForCreate({ createdBy: "worker-1" }, "codex", resolveCreator)).toBe("v1");
    expect(resolveCodexMultiAgentVersionForCreate({ createdBy: "missing" }, "codex", resolveCreator)).toBe("v1");
    expect(resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-archived" }, "codex", resolveCreator)).toBe(
      "v1",
    );
    expect(resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-hidden" }, "codex", resolveCreator)).toBe("v1");
  });

  it("keeps leaders, reviewers, assistant, hidden, resumes, manual, and non-Codex sessions off V2", () => {
    // These roles intentionally remain the V1 compatibility/control population.
    expect(
      resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-1", role: "orchestrator" }, "codex", resolveCreator),
    ).toBe("v1");
    expect(
      resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-1", reviewerOf: 42 }, "codex", resolveCreator),
    ).toBe("v1");
    expect(
      resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-1", assistantMode: true }, "codex", resolveCreator),
    ).toBe("v1");
    expect(
      resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-1", hidden: true }, "codex", resolveCreator),
    ).toBe("v1");
    expect(
      resolveCodexMultiAgentVersionForCreate(
        { createdBy: "leader-1", resumeCliSessionId: "existing-thread" },
        "codex",
        resolveCreator,
      ),
    ).toBe("v1");
    expect(resolveCodexMultiAgentVersionForCreate({}, "codex", resolveCreator)).toBe("v1");
    expect(resolveCodexMultiAgentVersionForCreate({ createdBy: "leader-1" }, "claude", resolveCreator)).toBeUndefined();
  });
});
