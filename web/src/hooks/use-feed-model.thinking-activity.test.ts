import type { ChatMessage, ContentBlock } from "../types.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { buildFeedModel, getEntryId } from "./use-feed-model.js";

// Producer-shaped Claude history: normalization copies thinking text into
// `content`, exactly as a leader thread receives it from the server.
function assistant(id: string, content: ContentBlock[], historyIndex: number): ChatMessage {
  return normalizeHistoryMessageToChatMessages(
    {
      type: "assistant",
      message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: null },
      parent_tool_use_id: null,
      timestamp: 1_791_362_900_000 + historyIndex,
    } as Parameters<typeof normalizeHistoryMessageToChatMessages>[0],
    historyIndex,
  )[0];
}

function bash(id: string, command: string, description: string): ContentBlock {
  return { type: "tool_use", id, name: "Bash", input: { command, description } };
}

describe("thinking inside leader activity", () => {
  it("keeps a thought before a needs-input notify inside the activity, not promoted as its preview", () => {
    // Shape of a leader quest-thread turn on the Copilot Claude route: the prose
    // explaining a sign-off arrives as a thinking block in the same message as
    // the `takode notify needs-input` command. Thinking is not agent text, so it
    // must stay activity instead of being promoted as the needs-input preview,
    // which pulled it out of the activity guide and split the group in two.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "Show me the needs-input split", timestamp: 1_791_362_800_000 },
      assistant("m1", [bash("t1", "takode board advance q-1", "Enter the sign-off checkpoint")], 1),
      assistant(
        "m2",
        [
          { type: "thinking", thinking: "" },
          {
            type: "thinking",
            thinking:
              "I've shared desktop and phone screenshots comparing the new needs-input split layout to the old " +
              'in-card style - reply "approve" to land it, or let me know what to adjust.\n\n',
          },
          bash("t2", 'takode notify needs-input "q-1: sign off?" --suggest approve', "Notify user of the sign-off"),
        ],
        2,
      ),
      assistant("m3", [bash("t3", "takode board set q-1 --wait-for-input 72", "Link board wait")], 3),
    ];

    const [turn] = buildFeedModel(messages, true).turns;

    const thought = turn.allEntries.find((entry) => entry.kind === "message" && entry.msg.id === "m2");
    expect(thought).toBeDefined();
    expect(turn.agentEntries.map(getEntryId)).toContain(getEntryId(thought!));
    expect(turn.collapsedEntries?.some((row) => row.kind === "entry")).toBe(false);
  });

  it("does not treat a thought before a herd event as a sub-conclusion", () => {
    // Sub-conclusions are retained text, which also breaks the activity guide.
    // A thinking-only message before a herd event is activity, not agent text.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "Check the worker", timestamp: 1_791_362_800_000 },
      assistant("m1", [bash("t1", "takode peek 5", "Peek at the worker")], 1),
      assistant("m2", [{ type: "thinking", thinking: "The worker is still running its tests." }], 2),
      {
        id: "herd-1",
        role: "user",
        content: "#5 | turn_end | done",
        timestamp: 1_791_362_900_003,
        agentSource: { sessionId: "herd-events" },
      },
      assistant("m3", [{ type: "text", text: "The worker finished." }], 4),
    ];

    const [turn] = buildFeedModel(messages, false).turns;

    expect(turn.subConclusions).toEqual([]);
  });
});
