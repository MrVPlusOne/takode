import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";
import { isDuplicateCodexAssistantReplay, prepareCodexPlanAssistantReplay } from "./codex-assistant-replay-dedup.js";

type AssistantMessage = Extract<BrowserIncomingMessage, { type: "assistant" }>;

function assistant(
  id: string,
  role: AssistantMessage["leaderThreadRole"],
  options: { phase?: AssistantMessage["codexMessagePhase"]; timestamp?: number; plan?: boolean } = {},
): AssistantMessage {
  const content = options.plan
    ? [
        {
          type: "tool_use" as const,
          id: "codex-plan-turn-1-1",
          name: "TodoWrite",
          input: { todos: [{ content: "Inspect", status: "in_progress", activeForm: "Inspecting" }] },
        },
      ]
    : [{ type: "text" as const, text: "Same routed prose." }];
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-test",
      content,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: options.timestamp ?? 100,
    threadKey: "main",
    ...(role ? { leaderThreadRole: role } : {}),
    ...(options.phase ? { codexMessagePhase: options.phase } : {}),
  };
}

function sessionWith(message: AssistantMessage): Session {
  return { messageHistory: [message] } as unknown as Session;
}

describe("Codex assistant replay role identity", () => {
  it("keeps commentary and final responses distinct in both same-id and fallback replay checks", () => {
    const commentary = assistant("shared-id", "commentary", { phase: "final_answer", timestamp: 100 });
    const sameIdFinal = assistant("shared-id", "response", { phase: "final_answer", timestamp: 100 });
    const fallbackFinal = assistant("different-id", "response", { phase: "final_answer", timestamp: 100 });

    expect(isDuplicateCodexAssistantReplay(sessionWith(commentary), sameIdFinal)).toBe(false);
    expect(isDuplicateCodexAssistantReplay(sessionWith(commentary), fallbackFinal)).toBe(false);
    expect(
      isDuplicateCodexAssistantReplay(
        sessionWith(commentary),
        assistant("different-id", "commentary", { phase: "final_answer", timestamp: 100 }),
      ),
    ).toBe(true);
  });

  it("continues to compare provider phase independently from the routed leader role", () => {
    const commentary = assistant("existing", "commentary", { phase: "commentary", timestamp: 100 });

    expect(
      isDuplicateCodexAssistantReplay(
        sessionWith(commentary),
        assistant("incoming", "commentary", { phase: "final_answer", timestamp: 100 }),
      ),
    ).toBe(false);
  });

  it("does not collapse a same-plan final into prior commentary with the same restarted sequence", () => {
    const commentary = assistant("codex-tool_use-codex-plan-turn-1-1", "commentary", { plan: true });
    const final = assistant("codex-tool_use-codex-plan-turn-1-1", "response", { plan: true });

    const prepared = prepareCodexPlanAssistantReplay(sessionWith(commentary), final);

    expect(prepared.isDuplicate).toBe(false);
    expect(prepared.message.leaderThreadRole).toBe("response");
    expect(prepared.message.message.id).toBe("codex-tool_use-codex-plan-turn-1-2");
    expect(prepared.message.message.content).toEqual([
      expect.objectContaining({ type: "tool_use", id: "codex-plan-turn-1-2" }),
    ]);
  });
});
