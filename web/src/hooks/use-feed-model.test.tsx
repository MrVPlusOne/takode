// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import type { ChatMessage } from "../types.js";
import { buildFeedModel, groupMessages, useFeedModel, summarizeHerdEvents } from "./use-feed-model.js";
import { buildFeedSections } from "../components/message-feed-sections.js";
import {
  THREAD_OUTCOME_REMINDER_SOURCE_ID,
  THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-outcome-reminder.js";
import {
  makeMessage,
  makeHerdEvent,
  makeInjectedUserMessage,
  makeVisibleLeaderMessage,
  makeThreadReadyStatus,
  makeAssistantMessage,
  entryIds,
  collapsedEntryIds,
} from "./use-feed-model.test-helpers.js";

describe("Claude empty thinking blocks", () => {
  // Opus via the Claude Agent SDK attaches a thinking block with no visible
  // text (only a signature) to most assistant messages, as stored in real
  // sessions. It renders as nothing, so it must not split command runs.
  function claudeBash(id: string, thinking: string | null): ChatMessage {
    return makeMessage({
      id,
      role: "assistant",
      contentBlocks: [
        ...(thinking === null ? [] : [{ type: "thinking" as const, thinking }]),
        { type: "tool_use", id: `${id}-tool`, name: "Bash", input: { command: `echo ${id}` } },
      ],
    });
  }

  it("groups consecutive commands whose thinking blocks are empty", () => {
    const entries = groupMessages([claudeBash("a", ""), claudeBash("b", null), claudeBash("c", "  ")]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "tool_msg_group",
      toolName: "Bash",
      firstId: "a",
      items: [{ id: "a-tool" }, { id: "b-tool" }, { id: "c-tool" }],
    });
  });

  it("keeps visible thinking as its own entry while its command joins the next run", () => {
    const entries = groupMessages([
      claudeBash("a", ""),
      claudeBash("b", "Check the flush path first."),
      claudeBash("c", ""),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(["tool_msg_group", "message", "tool_msg_group"]);
    expect(entries[1]).toMatchObject({ kind: "message", msg: { id: "b" } });
    expect(entries[1].kind === "message" && entries[1].msg.contentBlocks).toEqual([
      { type: "thinking", thinking: "Check the flush path first." },
    ]);
    expect(entries[2]).toMatchObject({ kind: "tool_msg_group", items: [{ id: "b-tool" }, { id: "c-tool" }] });
  });
});

describe("Claude notes followed by commands in the same message", () => {
  // Claude often sends "short note + Bash" as one assistant message, as stored
  // in real sessions. The note stays a message; the trailing commands join the
  // neighboring command run instead of staying behind as a lone chip.
  function noteWithBash(id: string, text: string, toolName = "Bash"): ChatMessage {
    return makeMessage({
      id,
      role: "assistant",
      content: text,
      contentBlocks: [
        { type: "text", text },
        { type: "tool_use", id: `${id}-tool`, name: toolName, input: { command: `echo ${id}` } },
      ],
    });
  }
  function bashOnly(id: string): ChatMessage {
    return makeMessage({
      id,
      role: "assistant",
      contentBlocks: [{ type: "tool_use", id: `${id}-tool`, name: "Bash", input: { command: `echo ${id}` } }],
    });
  }

  it("moves trailing commands into the following command run", () => {
    const entries = groupMessages([noteWithBash("a", "Now a quick browser check."), bashOnly("b"), bashOnly("c")]);

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "tool_msg_group"]);
    expect(entries[0].kind === "message" && entries[0].msg.contentBlocks).toEqual([
      { type: "text", text: "Now a quick browser check." },
    ]);
    expect(entries[1]).toMatchObject({
      kind: "tool_msg_group",
      firstId: "a:tools",
      items: [
        { id: "a-tool", messageId: "a" },
        { id: "b-tool", messageId: "b" },
        { id: "c-tool", messageId: "c" },
      ],
    });
  });

  it("keeps interactive tools and interleaved content inside their message", () => {
    const interleaved = makeMessage({
      id: "mixed",
      role: "assistant",
      content: "Before and after",
      contentBlocks: [
        { type: "text", text: "Before" },
        { type: "tool_use", id: "mixed-tool", name: "Bash", input: { command: "ls" } },
        { type: "text", text: "after" },
      ],
    });
    const entries = groupMessages([noteWithBash("ask", "Which option?", "AskUserQuestion"), interleaved]);

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "message"]);
    expect(entries[0].kind === "message" && entries[0].msg.contentBlocks).toHaveLength(2);
    expect(entries[1].kind === "message" && entries[1].msg.contentBlocks).toHaveLength(3);
  });
});

describe("canonical native Codex child transcript grouping", () => {
  it("keeps parented child rows top-level and isolates adjacent child/root tool groups", () => {
    const ownership = { childId: "opaque-child", rootTurnId: "root-turn" };
    const childResult = {
      tool_use_id: "shared-tool",
      content: "child-owned result",
      is_error: false,
      total_size: 18,
      is_truncated: false,
    };
    const entries = groupMessages([
      makeMessage({
        id: "spawn",
        role: "assistant",
        content: "",
        timestamp: 1,
        contentBlocks: [{ type: "tool_use", id: "spawn-tool", name: "Agent", input: { description: "Native child" } }],
      }),
      makeMessage({
        id: "child-answer",
        role: "assistant",
        content: "Child answer",
        timestamp: 2,
        parentToolUseId: "spawn-tool",
        metadata: { codexSubagent: ownership },
      }),
      makeMessage({
        id: "child-tool",
        role: "assistant",
        content: "",
        timestamp: 3,
        parentToolUseId: "spawn-tool",
        contentBlocks: [{ type: "tool_use", id: "shared-tool", name: "Bash", input: { command: "child" } }],
        metadata: {
          codexSubagent: ownership,
          codexSubagentToolResults: { "shared-tool": childResult },
        },
      }),
      makeMessage({
        id: "root-tool",
        role: "assistant",
        content: "",
        timestamp: 4,
        contentBlocks: [{ type: "tool_use", id: "root-shared-tool", name: "Bash", input: { command: "root" } }],
      }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(["subagent", "message", "tool_msg_group", "tool_msg_group"]);
    expect(entries[0]).toMatchObject({ kind: "subagent", taskToolUseId: "spawn-tool", children: [] });
    expect(entries[1]).toMatchObject({ kind: "message", msg: { id: "child-answer", parentToolUseId: "spawn-tool" } });
    expect(entries[2]).toMatchObject({
      kind: "tool_msg_group",
      items: [{ id: "shared-tool", codexSubagent: ownership, resultOverride: childResult }],
    });
    expect(entries[3]).toMatchObject({ kind: "tool_msg_group", items: [{ id: "root-shared-tool" }] });
  });
});

describe("sub-conclusions in collapsed turns", () => {
  // Sub-conclusions are assistant messages immediately preceding herd event injections.
  // They represent intermediate progress worth showing when a turn is collapsed.

  it("does not extract sub-conclusions from private leader output", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "orchestrate workers", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "Dispatched #5 to work on q-42.", timestamp: 2 }),
      makeHerdEvent("h1", "1 events from 1 sessions\n\n#5 | turn_end | ✓ 15.3s\n  [42] asst: Done", 3),
      makeMessage({ id: "a2", role: "assistant", content: "q-42 complete! Starting q-43.", timestamp: 4 }),
      makeHerdEvent("h2", "1 events from 1 sessions\n\n#6 | turn_end | ✓ 8.1s\n  [50] asst: Finished", 5),
      makeMessage({ id: "a3", role: "assistant", content: "All tasks complete.", timestamp: 6 }),
    ];

    const model = buildFeedModel(messages, true);
    expect(model.turns).toHaveLength(1);
    const turn = model.turns[0];

    expect(turn.subConclusions).toHaveLength(0);
    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.agentEntries)).toContain("a1");
    expect(entryIds(turn.agentEntries)).toContain("a2");
    expect(entryIds(turn.agentEntries)).toContain("a3");
  });

  it("groups consecutive herd events into a single summary", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "Started workers.", timestamp: 2 }),
      // Two consecutive herd events (common when multiple workers finish at once)
      makeHerdEvent("h1", "#264 | turn_end | ✓ 5s", 3),
      makeHerdEvent("h2", "#267 | turn_end | ✓ 8s", 4),
      makeMessage({ id: "a2", role: "assistant", content: "Both done.", timestamp: 5 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(
      summarizeHerdEvents([
        { kind: "message", msg: makeHerdEvent("summary-h1", "#264 | turn_end | ✓ 5s", 3) },
        { kind: "message", msg: makeHerdEvent("summary-h2", "#267 | turn_end | ✓ 8s", 4) },
      ]),
    ).toBe("Herd: #264 turn_end, #267 turn_end");
    expect(turn.subConclusions).toHaveLength(0);
  });

  it("returns empty subConclusions when no herd events exist", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "do something", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "Working on it...", timestamp: 2 }),
      makeMessage({ id: "a2", role: "assistant", content: "Done.", timestamp: 3 }),
    ];

    const model = buildFeedModel(messages, true);
    expect(model.turns[0].subConclusions).toHaveLength(0);
  });

  it("returns empty subConclusions for non-leader mode too (consistent interface)", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "hello", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "hi", timestamp: 2 }),
    ];

    const model = buildFeedModel(messages, false);
    expect(model.turns[0].subConclusions).toHaveLength(0);
  });

  it("keeps delayed herd events in the same Claude leader turn after a completed response", () => {
    // q-358: Claude leaders should now keep all herd/timer/notification-style
    // updates inside the same agent turn until a real human user message
    // arrives. Delayed herd activity no longer starts a synthetic extra turn.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "what is the prompt limit?", timestamp: 1_000 }),
      makeMessage({ id: "a1", role: "assistant", content: "It's 56K tokens.", timestamp: 10_000 }),
      makeHerdEvent("h1", "#193 | turn_end | ✓ 1m 38s", 185_000),
      makeMessage({ id: "a2", role: "assistant", content: "Routine update from #193. @to(self)", timestamp: 190_000 }),
      makeHerdEvent("h2", "#449 | turn_end | ✓ 33.0s", 320_000),
      makeMessage({ id: "a3", role: "assistant", content: "Routine update from #449. @to(self)", timestamp: 325_000 }),
    ];

    const model = buildFeedModel(messages, true);

    expect(model.turns).toHaveLength(1);
    expect(model.turns[0].userEntry?.kind).toBe("message");
    expect((model.turns[0].userEntry as { msg: ChatMessage }).msg.id).toBe("u1");
    expect(model.turns[0].responseEntry).toBeNull();
    expect(model.turns[0].stats.herdEventCount).toBe(2);
    expect(entryIds(model.turns[0].allEntries)).toContain("h1");
    expect(entryIds(model.turns[0].allEntries)).toContain("h2");
  });

  it("counts structured events inside one herd batch instead of counting only the wrapper message", () => {
    const batch = makeHerdEvent("h-batch", "3 events from 2 sessions", 2);
    batch.takodeHerdEvents = [
      { event: "turn_end", sessionId: "worker-1", sessionNum: 1, ts: 2, routine: true },
      {
        event: "turn_end",
        sessionId: "worker-2",
        sessionNum: 2,
        ts: 2,
        routine: false,
        lifecycle: ["context_continued"],
      },
      {
        event: "session_error",
        sessionId: "worker-2",
        sessionNum: 2,
        ts: 2,
        routine: false,
        lifecycle: ["failed"],
      },
    ];

    const turn = buildFeedModel([makeMessage({ id: "u1", role: "user", content: "status", timestamp: 1 }), batch], true)
      .turns[0];

    expect(turn.stats.herdEventCount).toBe(3);
    expect(turn.stats.herdEventLifecycle).toEqual(["context_continued", "failed"]);
  });

  it("keeps delayed herd events in the same turn when the leader only sent an in-progress status update", () => {
    // A single assistant status message ("let me check") should not be
    // treated as a completed answer. In that case, a later herd event still
    // belongs to the same orchestration turn.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "what's happening?", timestamp: 1_000 }),
      makeMessage({ id: "a1", role: "assistant", content: "Let me check that for you.", timestamp: 2_000 }),
      makeHerdEvent("h1", "#193 | turn_end | ✓ 1m 38s", 185_000),
      makeMessage({ id: "a2", role: "assistant", content: "Routine update from #193. @to(self)", timestamp: 190_000 }),
    ];

    const model = buildFeedModel(messages, true);

    expect(model.turns).toHaveLength(1);
    expect((model.turns[0].userEntry as { msg: ChatMessage }).msg.id).toBe("u1");
    expect(model.turns[0].stats.herdEventCount).toBe(1);
    expect(entryIds(model.turns[0].allEntries)).toContain("h1");
  });

  it("does not count responseEntry as a sub-conclusion when it precedes a herd event", () => {
    // Edge case: the last assistant message before a herd event at the end of the turn.
    // If the turn ends with: assistant → herd → (no more assistant), the last assistant
    // is both the responseEntry and the sub-conclusion candidate. It should only appear
    // as responseEntry.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "Only message before herd.", timestamp: 2 }),
      makeHerdEvent("h1", "#10 | turn_end | ✓ 2s", 3),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(turn.subConclusions).toHaveLength(0);
  });

  it("does not bridge across tool results between assistant and herd event", () => {
    // When a tool_use result sits between the assistant message and the herd event,
    // the assistant should NOT become a sub-conclusion (the sequence is broken).
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "Checking status...", timestamp: 2 }),
      // Tool result message (role=assistant, no text content, only tool_use blocks)
      makeMessage({
        id: "tool1",
        role: "assistant",
        content: "",
        timestamp: 3,
        contentBlocks: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }],
      }),
      makeMessage({ id: "r1", role: "system", content: "file1.ts\nfile2.ts", timestamp: 4 }),
      makeHerdEvent("h1", "#5 | turn_end | ✓ 3s", 5),
      makeMessage({ id: "a2", role: "assistant", content: "All done.", timestamp: 6 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    // a1 should NOT be a sub-conclusion because a tool result intervened
    expect(turn.subConclusions).toHaveLength(0);
    expect(turn.responseEntry).toBeNull();
  });

  it("picks only the last of consecutive assistant messages before a herd event", () => {
    // When two assistant messages appear in a row before a herd event,
    // only the second (immediately preceding) becomes the sub-conclusion.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "First thought.", timestamp: 2 }),
      makeMessage({ id: "a2", role: "assistant", content: "Second thought.", timestamp: 3 }),
      makeHerdEvent("h1", "#5 | turn_end | ✓ 3s", 4),
      makeMessage({ id: "a3", role: "assistant", content: "Done.", timestamp: 5 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.subConclusions).toHaveLength(0);
  });

  it("does not duplicate a notification-bearing assistant message as a sub-conclusion", () => {
    // q-524: a notification-bearing assistant message can remain visible in the
    // collapsed turn, but it must not also be promoted into subConclusions when
    // a herd event follows it.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "what changed?", timestamp: 1 }),
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "q-514 is complete and q-521 is unblocked.",
        timestamp: 2,
        notification: {
          category: "review",
          summary: "q-521 can be dispatched now",
          timestamp: 2,
        },
      }),
      makeHerdEvent("h1", "#514 | wait_for_resolved | ✓ q-521 unblocked", 3),
      makeMessage({ id: "u2", role: "user", content: "next", timestamp: 4 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.notificationEntries).toHaveLength(1);
    expect((turn.notificationEntries[0] as { kind: "message"; msg: ChatMessage }).msg.id).toBe("a1");
    expect(turn.subConclusions).toHaveLength(0);
    expect(turn.responseEntry).toBeNull();
  });

  it("keeps mixed tool-only assistant blocks in the feed grouping layer", () => {
    // Mixed Bash/Read messages must not fall back to MessageBubble, or a following tool message cannot join the same run.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "Inspect the files.", timestamp: 1 }),
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "",
        timestamp: 2,
        contentBlocks: [
          { type: "tool_use", id: "tu-command", name: "Bash", input: { command: "git status" } },
          { type: "tool_use", id: "tu-read-1", name: "Read", input: { file_path: "/a.ts" } },
        ],
      }),
      makeMessage({
        id: "a2",
        role: "assistant",
        content: "",
        timestamp: 3,
        contentBlocks: [{ type: "tool_use", id: "tu-read-2", name: "Read", input: { file_path: "/b.ts" } }],
      }),
    ];

    const model = buildFeedModel(messages, false);

    expect(model.entries.map((entry) => entry.kind)).toEqual(["message", "tool_msg_group", "tool_msg_group"]);
    const mixedGroup = model.entries[1];
    expect(mixedGroup?.kind).toBe("tool_msg_group");
    if (mixedGroup?.kind !== "tool_msg_group") throw new Error("expected a mixed tool group");
    expect(mixedGroup.mixedToolNames).toBe(true);
    expect(mixedGroup.items.map((item) => item.name)).toEqual(["Bash", "Read"]);
  });

  it("keeps a tool-only assistant message out of tool grouping when the store already has an anchored notification", () => {
    // q-568: during the lag window, the inbox notification can already be
    // anchored to the message before `msg.notification` lands on the assistant
    // payload. The feed model must preserve the assistant message so the richer
    // notification UI can render, rather than flattening it into a tool group.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "Tell me when the fix is ready.", timestamp: 1 }),
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "",
        timestamp: 2,
        contentBlocks: [
          {
            type: "tool_use",
            id: "tu-review",
            name: "Bash",
            input: { command: 'TAKODE_API_PORT=3455 takode notify review "q-568 ready"' },
          },
        ],
      }),
    ];

    const model = buildFeedModel(messages, false, 0, ["a1"]);

    expect(model.entries).toHaveLength(2);
    expect(model.entries[1]?.kind).toBe("message");
    expect((model.entries[1] as { kind: "message"; msg: ChatMessage }).msg.id).toBe("a1");
    expect(model.turns[0]?.notificationEntries).toHaveLength(1);
    expect((model.turns[0]?.notificationEntries[0] as { kind: "message"; msg: ChatMessage }).msg.id).toBe("a1");
    expect(model.turns[0]?.agentEntries).toHaveLength(0);
  });

  it("keeps source message ids on grouped terminal tool items", () => {
    // q-612: MessageFeed renders grouped terminal tools outside the original
    // assistant message component, so each item must retain its message id for
    // authoritative notification lookup and done-state rendering.
    const messages: ChatMessage[] = [
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "",
        timestamp: 1,
        contentBlocks: [
          {
            type: "tool_use",
            id: "tu-notify",
            name: "Bash",
            input: { command: 'takode notify needs-input "Need a decision"' },
          },
        ],
      }),
      makeMessage({
        id: "a2",
        role: "assistant",
        content: "",
        timestamp: 2,
        contentBlocks: [{ type: "tool_use", id: "tu-send", name: "Bash", input: { command: "takode send 942" } }],
      }),
    ];

    const model = buildFeedModel(messages, false);
    const group = model.entries[0];

    expect(group?.kind).toBe("tool_msg_group");
    if (group?.kind !== "tool_msg_group") throw new Error("expected a grouped terminal entry");
    expect(group.items.map((item) => item.messageId)).toEqual(["a1", "a2"]);
  });
});

describe("worker leader-source turn boundaries", () => {
  it("uses current herding leader messages as worker feed turn boundaries", () => {
    const messages: ChatMessage[] = [];
    for (let index = 1; index <= 12; index++) {
      messages.push(
        makeInjectedUserMessage(`leader-${index}`, `Leader instruction ${index}`, index * 10, "leader-session"),
        makeAssistantMessage(`assistant-${index}`, `Worker response ${index}`, index * 10 + 1),
      );
    }

    const model = buildFeedModel(messages, false, 0, undefined, "leader-session");

    expect(model.turns).toHaveLength(12);
    expect(model.turns.map((turn) => (turn.userEntry?.kind === "message" ? turn.userEntry.msg.id : null))).toEqual(
      Array.from({ length: 12 }, (_, index) => `leader-${index + 1}`),
    );
    expect(buildFeedSections(model.turns, 5)).toHaveLength(3);
  });

  it("does not turn injected user-shaped messages or leader-visible assistant rows into worker boundaries", () => {
    const messages: ChatMessage[] = [
      makeInjectedUserMessage("leader-1", "Leader instruction 1", 1, "leader-session"),
      makeAssistantMessage("assistant-1", "Worker response 1", 2),
      makeInjectedUserMessage("timer-1", "Timer fired", 3, "timer:t1", "Timer"),
      makeHerdEvent("herd-1", "#100 | turn_end | done", 4),
      makeInjectedUserMessage(
        "compaction-1",
        "Context was compacted. Before continuing, recover enough context from your own session history to safely resume work:",
        5,
        "system:compaction-recovery",
        "Compaction Recovery",
      ),
      makeInjectedUserMessage("system-1", "System reminder", 6, "system:tag-reminder", "System"),
      makeMessage({
        id: "kickoff-1",
        role: "user",
        content: "[System] You are a leader session. Historical kickoff without source metadata.",
        timestamp: 7,
      }),
      makeVisibleLeaderMessage("leader-visible-1", "Visible leader note", 8),
      makeInjectedUserMessage("leader-2", "Leader instruction 2", 9, "leader-session"),
      makeAssistantMessage("assistant-2", "Worker response 2", 10),
    ];

    const model = buildFeedModel(messages, false, 0, undefined, "leader-session");

    expect(model.turns).toHaveLength(2);
    expect(model.turns.map((turn) => (turn.userEntry?.kind === "message" ? turn.userEntry.msg.id : null))).toEqual([
      "leader-1",
      "leader-2",
    ]);
    expect(entryIds(model.turns[0].allEntries)).toEqual([
      "assistant-1",
      "timer-1",
      "herd-1",
      "compaction-1",
      "system-1",
      "kickoff-1",
      "leader-visible-1",
    ]);
  });

  it("keeps leader-source boundaries source-aware for unherded sessions", () => {
    const messages: ChatMessage[] = [
      makeInjectedUserMessage("leader-1", "Leader instruction 1", 1, "leader-session"),
      makeAssistantMessage("assistant-1", "Worker response 1", 2),
      makeInjectedUserMessage("leader-2", "Leader instruction 2", 3, "leader-session"),
      makeAssistantMessage("assistant-2", "Worker response 2", 4),
    ];

    expect(buildFeedModel(messages, false).turns).toHaveLength(1);
  });
});

describe("summarizeHerdEvents", () => {
  it("parses session number and event type from header lines", () => {
    const entry = {
      kind: "message" as const,
      msg: makeHerdEvent("h1", "1 events from 1 sessions\n\n#5 | turn_end | ✓ 15.3s\n  [42] asst: Done"),
    };
    const result = summarizeHerdEvents([entry]);
    expect(result).toBe("Herd: #5 turn_end");
  });

  it("combines multiple events from different messages", () => {
    const entries = [
      { kind: "message" as const, msg: makeHerdEvent("h1", "#264 | turn_end | ✓ 5s") },
      { kind: "message" as const, msg: makeHerdEvent("h2", "#267 | permission_request | pending") },
    ];
    const result = summarizeHerdEvents(entries);
    expect(result).toBe("Herd: #264 turn_end, #267 permission_request");
  });

  it("returns fallback for empty input", () => {
    expect(summarizeHerdEvents([])).toBe("Herd event");
  });
});

describe("useFeedModel", () => {
  it("matches the full feed model when given a frozen prefix and active tail", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "one", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "reply one", timestamp: 2 }),
      makeMessage({ id: "u2", role: "user", content: "two", timestamp: 3 }),
      makeMessage({ id: "a2", role: "assistant", content: "reply two", timestamp: 4 }),
    ];

    const full = buildFeedModel(messages);
    const { result } = renderHook(() => useFeedModel(messages, { frozenCount: 2, frozenRevision: 0 }));

    expect(result.current.turns.map((turn) => turn.id)).toEqual(full.turns.map((turn) => turn.id));
    expect(result.current.turns.map((turn) => turn.stats)).toEqual(full.turns.map((turn) => turn.stats));
  });

  it("keeps matching the full model when the frozen boundary advances after a completed turn", () => {
    const firstTurn: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "one", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "reply one", timestamp: 2 }),
    ];
    const secondTurn: ChatMessage[] = [
      makeMessage({ id: "u2", role: "user", content: "two", timestamp: 3 }),
      makeMessage({ id: "a2", role: "assistant", content: "reply two", timestamp: 4 }),
    ];
    const allMessages = [...firstTurn, ...secondTurn];

    const { result, rerender } = renderHook(
      ({ messages, frozenCount }) => useFeedModel(messages, { frozenCount, frozenRevision: 0 }),
      { initialProps: { messages: allMessages, frozenCount: 2 } },
    );

    expect(result.current.turns.map((turn) => turn.id)).toEqual(
      buildFeedModel(allMessages).turns.map((turn) => turn.id),
    );

    rerender({ messages: allMessages, frozenCount: 4 });

    expect(result.current.turns.map((turn) => turn.id)).toEqual(
      buildFeedModel(allMessages).turns.map((turn) => turn.id),
    );
    expect(
      result.current.turns.map((turn) => (turn.responseEntry?.kind === "message" ? turn.responseEntry.msg.id : null)),
    ).toEqual(
      buildFeedModel(allMessages).turns.map((turn) =>
        turn.responseEntry?.kind === "message" ? turn.responseEntry.msg.id : null,
      ),
    );
  });

  it("keeps a delayed herd batch merged across the frozen/active boundary", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "what is the prompt limit?", timestamp: 1_000 }),
      makeMessage({ id: "a1", role: "assistant", content: "It's 56K tokens.", timestamp: 10_000 }),
      makeHerdEvent("h1", "#193 | turn_end | ✓ 1m 38s", 185_000),
      makeMessage({ id: "a2", role: "assistant", content: "Routine update from #193. @to(self)", timestamp: 190_000 }),
    ];

    const full = buildFeedModel(messages, true);
    expect(full.turns).toHaveLength(1);

    const { result } = renderHook(() =>
      useFeedModel(messages, { leaderMode: true, frozenCount: 2, frozenRevision: 0 }),
    );

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns.map((turn) => turn.id)).toEqual(full.turns.map((turn) => turn.id));
    expect(result.current.turns[0].stats.herdEventCount).toBe(1);
    expect(entryIds(result.current.turns[0].allEntries)).toContain("h1");
  });

  it("recomputes the pre-reminder representative across the frozen/active boundary", () => {
    // In production the completed direct response can already be frozen when
    // the automatic reminder and empty Ready row arrive in the active tail.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "Regenerate the reviewer table", timestamp: 1 }),
      makeAssistantMessage("a-table", "| PR | Brief description | Suggested reviewer(s) |", 2),
      makeInjectedUserMessage(
        "u-outcome-reminder",
        "[Thread outcome reminder] Mark the touched thread with a fresh outcome.",
        3,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      makeMessage({
        id: "a-ready",
        role: "assistant",
        content: " \n ",
        timestamp: 4,
        metadata: { threadStatusMarkers: [makeThreadReadyStatus("a-ready", 4)] },
      }),
    ];
    const full = buildFeedModel(messages, true);

    const { result } = renderHook(() =>
      useFeedModel(messages, { leaderMode: true, frozenCount: 2, frozenRevision: 0 }),
    );

    expect(result.current.turns).toHaveLength(1);
    expect(collapsedEntryIds(result.current.turns[0])).toEqual(collapsedEntryIds(full.turns[0]));
    expect(entryIds(result.current.turns[0].notificationEntries)).toEqual(["a-table"]);
  });

  it("re-merges same-turn Codex leader activity with herd events across the frozen/active boundary", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "review the worker state", timestamp: 1_000 }),
      makeMessage({
        id: "a1",
        role: "assistant",
        content: "The prompt survived, and #496 already completed the planning turn.",
        timestamp: 4_000,
      }),
      makeHerdEvent("h1", "#496 | turn_end | ✓ 17s", 8_000),
      makeMessage({
        id: "a2",
        role: "assistant",
        content: "",
        timestamp: 9_000,
        contentBlocks: [{ type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "/tmp/q-352.md" } }],
      }),
      makeMessage({
        id: "a3",
        role: "assistant",
        content: "It returned a plan after reading the new feedback.",
        timestamp: 10_000,
      }),
    ];

    const full = buildFeedModel(messages, true);
    expect(full.turns).toHaveLength(1);

    const { result } = renderHook(() =>
      useFeedModel(messages, { leaderMode: true, frozenCount: 2, frozenRevision: 0 }),
    );

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns.map((turn) => turn.id)).toEqual(full.turns.map((turn) => turn.id));
    expect(entryIds(result.current.turns[0].allEntries)).toEqual(entryIds(full.turns[0].allEntries));
    expect(result.current.turns[0].stats.herdEventCount).toBe(1);
    expect(result.current.turns[0].stats.toolCount).toBe(1);
  });

  it("does not create extra turns for generated user-shaped messages between real user turns", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "real user request", timestamp: 1_000 }),
      makeMessage({ id: "a1", role: "assistant", content: "working on it", timestamp: 2_000 }),
      makeHerdEvent("h1", "#490 | turn_end | ✓ 5s", 3_000),
      makeInjectedUserMessage("t1", "[⏰ Timer tm-1] check progress", 4_000, "timer:tm-1", "Timer tm-1"),
      makeInjectedUserMessage(
        "s1",
        "[System reminder] tag your response",
        4_500,
        "system:leader-tag-enforcer",
        "System",
      ),
      makeInjectedUserMessage("w1", "Worker status update", 4_750, "worker-1", "#2 worker"),
      makeMessage({ id: "a2", role: "assistant", content: "still same agent turn", timestamp: 5_000 }),
      makeMessage({ id: "u2", role: "user", content: "human follow-up", timestamp: 6_000 }),
      makeMessage({ id: "a3", role: "assistant", content: "new turn response", timestamp: 7_000 }),
    ];

    const model = buildFeedModel(messages, true);
    expect(model.turns).toHaveLength(2);
    expect((model.turns[0].userEntry as { msg: ChatMessage }).msg.id).toBe("u1");
    expect(entryIds(model.turns[0].allEntries)).toEqual(["a1", "h1", "t1", "s1", "w1", "a2"]);
    expect((model.turns[1].userEntry as { msg: ChatMessage }).msg.id).toBe("u2");
    expect(entryIds(model.turns[1].allEntries)).toEqual(["a3"]);
  });
});
