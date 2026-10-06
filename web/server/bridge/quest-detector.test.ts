import { describe, expect, it, vi } from "vitest";
import { detectQuestEvent } from "./quest-detector.js";
import { reconcileCodexQuestToolResult, trackCodexQuestCommands } from "./session-registry-controller.js";

describe("authored reports are not quest lifecycle receipts", () => {
  it("does not complete a quest when literal report text contains a command example", async () => {
    // The existing command hint parser can see an example inside a quoted argument.
    // Only an actual lifecycle result may confirm that hint; report JSON is informational.
    const session = {
      pendingQuestCommands: new Map(),
      state: { claimedQuestId: "q-1", claimedQuestStatus: "in_progress" },
    } as unknown as Parameters<typeof trackCodexQuestCommands>[0];
    const before = structuredClone(session.state);
    trackCodexQuestCommands(session, [
      {
        type: "tool_use",
        id: "report-call",
        name: "Bash",
        input: {
          command: "takode worker-stream --text 'An example: quest complete q-1' --json",
        },
      },
    ]);
    const deps = {
      resolveQuestTitle: vi.fn(),
      broadcastTaskHistory: vi.fn(),
      persistSession: vi.fn(),
      broadcastToBrowsers: vi.fn(),
      getLauncherSessionInfo: vi.fn(),
      onSessionNamedByQuest: vi.fn(),
    };
    await reconcileCodexQuestToolResult(
      session,
      {
        type: "tool_result",
        tool_use_id: "report-call",
        content: JSON.stringify({
          ok: true,
          recorded: true,
          queued: true,
          questId: "q-1",
          reportId: "worker-report:example",
          feedbackIndex: 3,
        }),
      },
      deps,
    );
    expect(session.state).toEqual(before);
    expect(session.pendingQuestCommands.size).toBe(0);
    expect(deps.persistSession).not.toHaveBeenCalled();
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("still recognizes real lifecycle receipts", () => {
    expect(
      detectQuestEvent({ kind: "result", text: JSON.stringify({ questId: "q-1", status: "done" }) }),
    ).toMatchObject({ questId: "q-1", status: "done" });
  });
});
