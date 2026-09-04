import { describe, expect, it, vi } from "vitest";
import {
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
} from "../../shared/injected-event-message.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { appendCodexLeaderRecoveryDiagnostic } from "./codex-leader-recovery-diagnostic.js";

describe("Codex leader recovery diagnostic", () => {
  it("uses plain audit copy without the retired attention action", () => {
    const session = { messageHistory: [] as BrowserIncomingMessage[] };
    const broadcastToBrowsers = vi.fn();

    expect(
      appendCodexLeaderRecoveryDiagnostic(
        session,
        "recovery-owner",
        { threadKey: "q-2011", questId: "q-2011" },
        { broadcastToBrowsers },
      ),
    ).toBe("appended");

    const entry = session.messageHistory[0];
    expect(entry).toMatchObject({
      type: "user_message",
      agentSource: {
        sessionId: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
        sessionLabel: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
      },
      codexTurnRecoveryId: "recovery-owner",
      threadKey: "q-2011",
      questId: "q-2011",
    });
    expect(entry?.type === "user_message" ? entry.content : "").toContain(
      "retrying automatically could repeat actions",
    );
    expect(entry?.type === "user_message" ? entry.content : "").toContain("Send a new instruction in this thread");
    expect(entry?.type === "user_message" ? entry.content : "").toContain("otherwise no action is required");
    expect(entry?.type === "user_message" ? entry.content : "").not.toContain("Check interrupted work");
    expect(entry?.type === "user_message" ? entry.content : "").not.toContain("Work is complete");
    expect(entry?.type === "user_message" ? entry.content : "").not.toMatch(
      /proof-safe|eligible|exact owner|payload|exact-once|bounded inner cycles/i,
    );
    expect(broadcastToBrowsers).toHaveBeenCalledWith(session, entry);

    expect(
      appendCodexLeaderRecoveryDiagnostic(
        session,
        "recovery-owner",
        { threadKey: "q-2011", questId: "q-2011" },
        { broadcastToBrowsers },
      ),
    ).toBe("existing_unresolved");
    expect(session.messageHistory).toHaveLength(1);
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(1);

    if (entry?.type === "user_message") entry.codexTurnRecoveryResolvedAt = 200;
    expect(
      appendCodexLeaderRecoveryDiagnostic(
        session,
        "recovery-owner",
        { threadKey: "q-2011", questId: "q-2011" },
        { broadcastToBrowsers },
      ),
    ).toBe("resolved_conflict");
    expect(session.messageHistory).toHaveLength(1);
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(1);
  });
});
