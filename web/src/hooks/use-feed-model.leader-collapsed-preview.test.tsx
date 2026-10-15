// @vitest-environment jsdom

import type { ChatMessage } from "../types.js";
import { buildFeedModel } from "./use-feed-model.js";
import {
  THREAD_OUTCOME_REMINDER_SOURCE_ID,
  THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-outcome-reminder.js";
import {
  THREAD_ROUTING_REMINDER_SOURCE_ID,
  THREAD_ROUTING_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-routing-reminder.js";
import {
  makeMessage,
  makeHerdEvent,
  makeInjectedUserMessage,
  makeNotifyToolMessage,
  makeVisibleLeaderMessage,
  makeThreadReadyStatus,
  makeAssistantMessage,
  makePhasedAssistant,
  makeRoutedLeaderAssistant,
  makeReworkMilestoneRecord,
  entryIds,
  collapsedEntryIds,
} from "./use-feed-model.test-helpers.js";

describe("leader mode raw deprecated tags", () => {
  it("keeps deprecated @to(user) text as private activity", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "do the thing", timestamp: 1 }),
      makeMessage({ id: "a-internal", role: "assistant", content: "Let me think about this...", timestamp: 2 }),
      makeMessage({ id: "a-touser", role: "assistant", content: "Here's the result @to(user)", timestamp: 3 }),
    ];

    const model = buildFeedModel(messages, true);
    expect(model.turns).toHaveLength(1);
    const turn = model.turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.agentEntries)).toContain("a-internal");
    expect(entryIds(turn.agentEntries)).toContain("a-touser");
    expect(entryIds(turn.allEntries)).toContain("a-touser");
  });

  it("keeps earlier deprecated-tag messages inside agentEntries", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a-internal", role: "assistant", content: "Planning...", timestamp: 2 }),
      makeMessage({ id: "a-touser-1", role: "assistant", content: "First update @to(user)", timestamp: 3 }),
      makeMessage({ id: "a-internal2", role: "assistant", content: "More internal work...", timestamp: 4 }),
      makeMessage({ id: "a-touser-2", role: "assistant", content: "Final result @to(user)", timestamp: 5 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.agentEntries)).toContain("a-touser-2");
    expect(entryIds(turn.agentEntries)).toContain("a-touser-1");
    expect(entryIds(turn.agentEntries)).toContain("a-internal");
    expect(entryIds(turn.agentEntries)).toContain("a-internal2");
  });

  it("keeps deprecated @to(self) messages visible in leader mode", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a-self", role: "assistant", content: "Internal handoff @to(self)", timestamp: 2 }),
      makeMessage({ id: "a-touser", role: "assistant", content: "Done @to(user)", timestamp: 3 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(entryIds(turn.agentEntries)).toContain("a-self");
    expect(entryIds(turn.allEntries)).toContain("a-self");
  });

  it("counts deprecated-tagged messages like normal assistant messages", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a-int1", role: "assistant", content: "thinking...", timestamp: 2 }),
      makeMessage({ id: "a-int2", role: "assistant", content: "more thinking...", timestamp: 3 }),
      makeMessage({ id: "a-self", role: "assistant", content: "handoff @to(self)", timestamp: 4 }),
      makeMessage({ id: "a-touser", role: "assistant", content: "result @to(user)", timestamp: 5 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.stats.messageCount).toBe(4);
  });
});

describe("leader mode collapsed preview without deprecated metadata", () => {
  it("keeps ordinary assistant messages private instead of promoting a responseEntry", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "work on task q-42", timestamp: 1 }),
      makeMessage({ id: "a1", role: "assistant", content: "Starting work on task q-42...", timestamp: 2 }),
      makeMessage({ id: "a2", role: "assistant", content: "I've completed the implementation.", timestamp: 3 }),
    ];

    const model = buildFeedModel(messages, true);
    expect(model.turns).toHaveLength(1);
    const turn = model.turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.agentEntries)).toContain("a1");
    expect(entryIds(turn.agentEntries)).toContain("a2");
  });

  it("keeps @to(self) text private like ordinary leader output", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a-self", role: "assistant", content: "Internal coordination @to(self)", timestamp: 2 }),
      makeMessage({ id: "a-normal", role: "assistant", content: "Done with the task.", timestamp: 3 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.agentEntries)).toContain("a-self");
    expect(entryIds(turn.agentEntries)).toContain("a-normal");
    expect(entryIds(turn.allEntries)).toContain("a-self");
  });

  it("does not promote last assistant text over earlier deprecated-tagged messages", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a-touser", role: "assistant", content: "Status update @to(user)", timestamp: 2 }),
      makeMessage({ id: "a-final", role: "assistant", content: "All done, synced to main.", timestamp: 3 }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.agentEntries)).toContain("a-touser");
    expect(entryIds(turn.agentEntries)).toContain("a-final");
  });

  it("keeps unproven legacy leader-visible rows behind expansion", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "go", timestamp: 1 }),
      makeMessage({ id: "a-private", role: "assistant", content: "private coordination", timestamp: 2 }),
      makeMessage({
        id: "a-visible",
        role: "assistant",
        content: "Visible leader update",
        timestamp: 3,
        metadata: { leaderUserMessage: true },
      }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.notificationEntries)).toEqual([]);
    expect(entryIds(turn.agentEntries)).toEqual(["a-private", "a-visible"]);
    expect(turn.stats.messageCount).toBe(2);
  });

  it("keeps attention milestones in chronological collapsed-turn order", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "coordinate rework", timestamp: 1 }),
      makeMessage({
        id: "a-visible-before",
        role: "assistant",
        content: "Visible leader update before the rework milestone.",
        timestamp: 2,
        metadata: { leaderUserMessage: true },
      }),
      makeMessage({
        id: "a-private-before",
        role: "assistant",
        content: "private work before the milestone",
        timestamp: 3,
      }),
      makeMessage({
        id: "rework-milestone",
        role: "system",
        content: "Open: Rework requested",
        timestamp: 4,
        variant: "info",
        metadata: { attentionRecord: makeReworkMilestoneRecord({ createdAt: 4, updatedAt: 4 }) },
      }),
      makeMessage({
        id: "a-private-after",
        role: "assistant",
        content: "private work after the milestone",
        timestamp: 5,
      }),
      makeMessage({
        id: "a-visible-after",
        role: "assistant",
        content: "Visible leader update after the rework milestone.",
        timestamp: 6,
        metadata: { leaderUserMessage: true },
      }),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(entryIds(turn.systemEntries)).not.toContain("rework-milestone");
    expect(entryIds(turn.notificationEntries)).toEqual(["rework-milestone"]);
    expect(collapsedEntryIds(turn)).toEqual(["activity", "rework-milestone", "activity"]);
    expect(entryIds(turn.agentEntries)).toEqual([
      "a-visible-before",
      "a-private-before",
      "a-private-after",
      "a-visible-after",
    ]);
  });
});

describe("leader mode segment-local needs-input preview selection", () => {
  it("keeps unproven legacy status prose behind expansion", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "coordinate work", timestamp: 1 }),
      makeMessage({ id: "a-private", role: "assistant", content: "Checking the board before routing.", timestamp: 2 }),
      makeVisibleLeaderMessage("a-status", "Worker is dispatched and I’m waiting for the read-in.", 3),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["activity"]);
    expect(entryIds(turn.notificationEntries)).toEqual([]);
    expect(entryIds(turn.agentEntries)).toEqual(["a-private", "a-status"]);
  });

  it("promotes the proposal immediately before a needs-input notify call", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "make a quest", timestamp: 1 }),
      makeMessage({
        id: "a-proposal",
        role: "assistant",
        content:
          "Proposed Quest\n\n- Title: Improve collapsed previews\n- Goal / Acceptance: keep proposals visible when confirmation is requested.",
        timestamp: 2,
      }),
      makeNotifyToolMessage("a-notify", 3),
      makeVisibleLeaderMessage("a-waiting", "Waiting on confirmation before creating the quest.", 4),
    ];

    const model = buildFeedModel(messages, true, 0, ["a-notify"]);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-proposal", "a-notify", "a-waiting"]);
    expect(entryIds(turn.agentEntries)).toEqual([]);
    expect(turn.stats.messageCount).toBe(0);
  });

  it("promotes the proposal immediately after a needs-input notify call", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "revise the proposal", timestamp: 1 }),
      makeNotifyToolMessage("a-notify", 2),
      makeMessage({
        id: "a-proposal",
        role: "assistant",
        content:
          "Proposed Quest\n\n- Title: Revised preview heuristic\n- Goal / Acceptance: implement the user-approved segment-local behavior.",
        timestamp: 3,
      }),
      makeVisibleLeaderMessage("a-waiting", "Approval notification `42` is open for the revised proposal.", 4),
    ];

    const model = buildFeedModel(messages, true, 0, ["a-notify"]);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-notify", "a-proposal", "a-waiting"]);
    expect(entryIds(turn.agentEntries)).toEqual([]);
  });

  it("promotes same-response text that also invokes a needs-input notify tool", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "confirm this plan", timestamp: 1 }),
      makeMessage({
        id: "a-mixed",
        role: "assistant",
        content:
          "Proposed Quest\n\n- Title: Same response proposal\n- Goal / Acceptance: keep text eligible even when the response also calls notify.",
        timestamp: 2,
        contentBlocks: [
          {
            type: "tool_use",
            id: "notify-tool",
            name: "Bash",
            input: { command: 'takode notify needs-input "approve same response proposal"' },
          },
        ],
      }),
      makeVisibleLeaderMessage("a-waiting", "Approval notification `43` is open for the same-response proposal.", 3),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-mixed", "a-waiting"]);
    expect(entryIds(turn.agentEntries)).toEqual([]);
  });

  it("finds the proposal across intervening tool activity before the notify call", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "investigate CI", timestamp: 1 }),
      makeMessage({
        id: "a-proposal",
        role: "assistant",
        content:
          "Checkpoint for [q-1335](quest:q-1335):\n\nFindings:\n- The failing job is macOS `bun run test`.\n- The user must choose the fix scope.",
        timestamp: 2,
      }),
      makeMessage({
        id: "a-board-tool",
        role: "assistant",
        content: "",
        timestamp: 3,
        contentBlocks: [
          { type: "tool_use", id: "board-tool", name: "Bash", input: { command: "takode board detail q-1335" } },
        ],
      }),
      makeNotifyToolMessage("a-notify", 4),
      makeMessage({
        id: "a-set-tool",
        role: "assistant",
        content: "",
        timestamp: 5,
        contentBlocks: [
          { type: "tool_use", id: "set-tool", name: "Bash", input: { command: "takode board set q-1335" } },
        ],
      }),
      makeVisibleLeaderMessage(
        "a-waiting",
        "Published the checkpoint and linked [q-1335](quest:q-1335) to needs-input `215`.",
        6,
      ),
    ];

    const model = buildFeedModel(messages, true, 0, ["a-notify"]);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-proposal", "activity", "a-notify", "activity", "a-waiting"]);
    expect(entryIds(turn.agentEntries)).toEqual([]);
  });

  it("uses the successful retry context when a prior needs-input notify attempt was orphaned", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "change this icon", timestamp: 1 }),
      makeMessage({
        id: "a-proposal",
        role: "assistant",
        content:
          "Proposed Quest\n\n- Title: Replace Memory tab icon with a brain icon\n- Goal / Acceptance: preserve navigation behavior and layout stability.",
        timestamp: 2,
      }),
      makeNotifyToolMessage("a-orphaned-notify", 3),
      makeNotifyToolMessage("a-retry-notify", 4),
      makeVisibleLeaderMessage(
        "a-waiting",
        "Approval notification `390` is open for the Memory tab brain icon quest.",
        5,
      ),
    ];

    const model = buildFeedModel(messages, true, 0, ["a-retry-notify"]);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-proposal", "activity", "a-retry-notify", "a-waiting"]);
    expect(entryIds(turn.agentEntries)).toEqual([]);
  });

  it("keeps a proposal visible when later approval-created bookkeeping follows the notify call", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "propose the quest", timestamp: 1 }),
      makeMessage({
        id: "a-setup",
        role: "assistant",
        content: "I’ll check the existing guidance first.",
        timestamp: 2,
      }),
      makeMessage({
        id: "a-tool",
        role: "assistant",
        content: "",
        timestamp: 3,
        contentBlocks: [
          { type: "tool_use", id: "context-tool", name: "Bash", input: { command: "quest show q-1294" } },
        ],
      }),
      makeMessage({
        id: "a-proposal",
        role: "assistant",
        content: [
          "Proposed Quest",
          "",
          "- Title: Make leader quest proposals human-readable",
          "- Relationship: follow-up of [q-1294](quest:q-1294)",
          "",
          "Goal",
          "Update `quest-design`, `leader-dispatch`, and related guidance so visible approval proposals are concise.",
          "",
          "Journey",
          "alignment -> implement -> code-review -> mental-simulation -> port -> memory",
        ].join("\n"),
        timestamp: 4,
      }),
      makeNotifyToolMessage("a-notify", 5),
      makeVisibleLeaderMessage(
        "a-bookkeeping",
        "Proposed the concise quest and created approval notification `292`.",
        6,
      ),
    ];

    const model = buildFeedModel(messages, true, 0, ["a-notify"]);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-proposal", "a-notify", "activity"]);
    expect(entryIds(turn.notificationEntries)).toEqual(["a-notify"]);
    expect(entryIds(turn.agentEntries)).toContain("a-bookkeeping");
  });

  it("demotes concise approval-created bookkeeping even when it is the first visible entry after notify", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "propose the quest", timestamp: 1 }),
      makeMessage({
        id: "a-proposal",
        role: "assistant",
        content:
          "Proposed Quest\n\n- Title: Fix collapsed previews\n- Goal / Acceptance: preserve needs-input proposal text.",
        timestamp: 2,
      }),
      makeNotifyToolMessage("a-notify", 3),
      makeVisibleLeaderMessage("a-bookkeeping", "Created approval notification `42` for the preview proposal.", 4),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-proposal", "activity"]);
    expect(entryIds(turn.notificationEntries)).toEqual([]);
    expect(entryIds(turn.agentEntries)).toContain("a-bookkeeping");
  });

  it("keeps approval-created bookkeeping visible when there is no substantive proposal to promote", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "open a decision prompt", timestamp: 1 }),
      makeNotifyToolMessage("a-notify", 2),
      makeVisibleLeaderMessage("a-bookkeeping", "Created approval notification `42` for the decision.", 3),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-bookkeeping"]);
    expect(entryIds(turn.notificationEntries)).toEqual(["a-bookkeeping"]);
    expect(turn.agentEntries.some((entry) => entry.kind === "tool_msg_group" && entry.firstId === "a-notify")).toBe(
      true,
    );
  });

  it("keeps a later status-only needs-input segment visible after an earlier proposal segment", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "open two approval prompts", timestamp: 1 }),
      makeMessage({
        id: "a-proposal-1",
        role: "assistant",
        content:
          "Proposed Quest\n\n- Title: First preview case\n- Goal / Acceptance: keep this proposal visible near the first notification.",
        timestamp: 2,
      }),
      makeNotifyToolMessage("a-notify-1", 3),
      makeVisibleLeaderMessage("a-bookkeeping-1", "Created approval notification `41` for the first proposal.", 4),
      makeNotifyToolMessage("a-notify-2", 5),
      makeVisibleLeaderMessage("a-bookkeeping-2", "Created approval notification `42` for the second decision.", 6),
    ];

    const model = buildFeedModel(messages, true, 0, ["a-notify-1", "a-notify-2"]);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual([
      "a-proposal-1",
      "a-notify-1",
      "activity",
      "a-notify-2",
      "a-bookkeeping-2",
    ]);
    expect(entryIds(turn.notificationEntries)).toEqual(["a-notify-1", "a-notify-2", "a-bookkeeping-2"]);
    expect(entryIds(turn.agentEntries)).toContain("a-bookkeeping-1");
    expect(entryIds(turn.agentEntries)).not.toContain("a-bookkeeping-2");
  });

  it("falls back to the existing short status when the segment has no substantive proposal", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "open a decision prompt", timestamp: 1 }),
      makeNotifyToolMessage("a-notify", 2),
      makeVisibleLeaderMessage("a-waiting", "Waiting on confirmation before dispatch.", 3),
    ];

    const model = buildFeedModel(messages, true, 0, ["a-notify"]);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-notify", "a-waiting"]);
    expect(entryIds(turn.agentEntries)).toEqual([]);
  });
});

describe("leader mode model-only reminder collapsed preview selection", () => {
  it.each([
    [THREAD_OUTCOME_REMINDER_SOURCE_ID, THREAD_OUTCOME_REMINDER_SOURCE_LABEL],
    [THREAD_ROUTING_REMINDER_SOURCE_ID, THREAD_ROUTING_REMINDER_SOURCE_LABEL],
  ])("hides plain leader summaries after %s trigger turns", (sourceId, sourceLabel) => {
    // Model-only reminder turns often end with acknowledgement prose; that prose
    // should stay in expanded activity instead of becoming the collapsed summary.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "coordinate the quest", timestamp: 1 }),
      makeVisibleLeaderMessage("a-before-reminder", "The user-triggered work is ready for review.", 2),
      makeInjectedUserMessage("u-reminder", `[${sourceLabel}] Missing thread outcome.`, 3, sourceId, sourceLabel),
      makeMessage({
        id: "a-reminder-tool",
        role: "assistant",
        content: "",
        timestamp: 4,
        contentBlocks: [{ type: "tool_use", id: "reminder-tool", name: "Bash", input: { command: "takode status" } }],
      }),
      makeVisibleLeaderMessage(
        "a-reminder-ack",
        "Handled the reminder and corrected the thread status bookkeeping.",
        5,
      ),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["a-before-reminder", "activity"]);
    expect(entryIds(turn.notificationEntries)).toEqual(["a-before-reminder"]);
    expect(entryIds(turn.agentEntries)).toContain("a-reminder-ack");
  });

  it.each([
    ["timer reminder", "timer:t1", "Timer t1"],
    ["another agent", "agent-session-1", "#12 Worker"],
    ["herd event", "herd-events", "Herd Events"],
    ["recovery prompt", "system:restart-continuation:prep-1", "System"],
  ])("keeps unproven legacy summaries after %s trigger turns behind expansion", (_name, sourceId, sourceLabel) => {
    // Injected sources remain part of the same direct-human UI turn. Without
    // answer-role or phase proof, their follow-up prose cannot invent a
    // collapsed answer merely because the backend started another turn.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "watch the next event", timestamp: 1 }),
      makeInjectedUserMessage("u-trigger", "Legitimate request for follow-up action.", 2, sourceId, sourceLabel),
      makeVisibleLeaderMessage("a-status", "Handled the new request and reported the outcome.", 3),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["activity"]);
    expect(entryIds(turn.notificationEntries)).toEqual([]);
    expect(entryIds(turn.agentEntries)).toContain("a-status");
  });

  it("keeps unproven direct-user legacy summaries behind expansion", () => {
    // Human messages are real turn boundaries, but old leader-visible metadata
    // alone is not answer proof after the explicit-answer cutover.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "first request", timestamp: 1 }),
      makeVisibleLeaderMessage("a-first", "First request is complete.", 2),
      makeMessage({ id: "u2", role: "user", content: "second request", timestamp: 3 }),
      makeVisibleLeaderMessage("a-second", "Second direct request is complete.", 4),
    ];

    const model = buildFeedModel(messages, true);

    expect(model.turns).toHaveLength(2);
    expect(collapsedEntryIds(model.turns[0])).toEqual(["activity"]);
    expect(collapsedEntryIds(model.turns[1])).toEqual(["activity"]);
    expect(entryIds(model.turns[0].agentEntries)).toContain("a-first");
    expect(entryIds(model.turns[1].agentEntries)).toContain("a-second");
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t  "],
  ])("keeps the last substantive normal response when the later Ready row is %s", (_variant, readyContent) => {
    // Producer-shaped regression: a direct user response is followed by the
    // model-only outcome reminder, reasoning/activity, and a Ready marker whose
    // assistant payload contains no substantive prose. The earlier response is
    // still the collapsed representative; empty route/status rows stay activity.
    const readyStatus = {
      ...makeThreadReadyStatus("a-ready", 7),
      threadKey: "q-1874",
      questId: "q-1874",
      summary: "shareable reviewer table ready",
    };
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "Regenerate the reviewer table", timestamp: 1 }),
      makeAssistantMessage("a-progress", "I’m formatting the reviewer assignments now.", 2),
      makeAssistantMessage(
        "a-table",
        "| PR | Brief description | Suggested reviewer(s) |\n|---|---|---|\n| #68139 | Recover lost Responses API state | Qingyu + additional code owner required |",
        3,
      ),
      makeMessage({
        id: "a-route-only",
        role: "assistant",
        content: " \n\t",
        timestamp: 4,
        contentBlocks: [{ type: "text", text: " \n\t" }],
        metadata: { leaderUserMessage: true },
      }),
      makeInjectedUserMessage(
        "u-outcome-reminder",
        "[Thread outcome reminder] Mark the touched thread with a fresh outcome.",
        5,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      makeMessage({
        id: "a-reasoning",
        role: "assistant",
        content: "Marking quest readiness",
        timestamp: 6,
        metadata: { codexReasoningDetail: { status: "complete" } },
      }),
      makeMessage({
        id: "a-ready",
        role: "assistant",
        content: readyContent,
        timestamp: 7,
        contentBlocks: [{ type: "text", text: readyContent }],
        metadata: { threadStatusMarkers: [readyStatus] },
      }),
      makeHerdEvent("h-memory-complete", "#2504 | turn_end | ok | reviewer plan complete", 8),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-table", "activity"]);
    expect(entryIds(turn.notificationEntries)).toEqual(["a-table"]);
    expect(entryIds(turn.agentEntries)).toEqual(
      expect.arrayContaining(["a-progress", "a-reasoning", "h-memory-complete"]),
    );
    expect(entryIds(turn.agentEntries)).not.toEqual(expect.arrayContaining(["a-route-only", "a-ready"]));
    expect(entryIds(turn.allEntries)).toEqual(expect.arrayContaining(["a-route-only", "a-ready"]));
  });

  it("does not infer a pre-reminder representative when the loaded turn has no trigger boundary", () => {
    // A selected-window slice can start mid-turn. Without the originating user
    // or injected-request boundary, plain assistant text must stay private
    // rather than being guessed as a user-visible representative.
    const messages: ChatMessage[] = [
      makeAssistantMessage("a-window-tail", "Potentially private activity from before the loaded window.", 1),
      makeInjectedUserMessage(
        "u-outcome-reminder",
        "[Thread outcome reminder] Mark the touched thread with a fresh outcome.",
        2,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      makeMessage({
        id: "a-ready",
        role: "assistant",
        content: "",
        timestamp: 3,
        metadata: { threadStatusMarkers: [makeThreadReadyStatus("a-ready", 3)] },
      }),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["activity"]);
    expect(entryIds(turn.notificationEntries)).toEqual([]);
    expect(entryIds(turn.agentEntries)).toContain("a-window-tail");
  });

  it("keeps the final substantive status-bearing leader prose visible before a reminder resend", () => {
    // Regression for the live q-1814 shape: a normal completion turn ended
    // with substantial leader prose plus a Thread Ready marker, then a routing
    // reminder triggered a duplicate resend. The original final prose must stay
    // visible, while the reminder-triggered duplicate remains activity.
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "revise the Slack draft", timestamp: 1 }),
      makeHerdEvent("h-complete", "#2444 | turn_end | ok | q-1814: in_progress -> done", 2),
      makeMessage({
        id: "a-pulling-draft",
        role: "assistant",
        content: "The revised draft and both metric tables are ready. I’m pulling the exact text for review.",
        timestamp: 3,
      }),
      makeMessage({
        id: "a-tool",
        role: "assistant",
        content: "",
        timestamp: 4,
        contentBlocks: [
          { type: "tool_use", id: "quest-feedback", name: "Bash", input: { command: "quest feedback show q-1814 5" } },
        ],
      }),
      makeMessage({
        id: "a-final-draft",
        role: "assistant",
        content:
          "Yes. The percentage table is `normalized_score >= 0.5`.\n\n**Recommendation:** use the failure-inclusive average-score table in the main post.\n\n### Message 1\n~~~text\nQuick update on our conversation-seeded synthetic coding-QA pipeline.\n~~~",
        timestamp: 5,
        metadata: {
          threadRefs: [{ threadKey: "q-1814", questId: "q-1814", source: "explicit" }],
          threadStatusMarkers: [makeThreadReadyStatus("a-final-draft", 5)],
        },
      }),
      makeInjectedUserMessage(
        "u-routing-reminder",
        "[Thread routing reminder] Missing thread marker on visible leader text.",
        6,
        THREAD_ROUTING_REMINDER_SOURCE_ID,
        THREAD_ROUTING_REMINDER_SOURCE_LABEL,
      ),
      makeMessage({
        id: "a-reminder-resend",
        role: "assistant",
        content:
          "The percentage table is `normalized_score >= 0.5`.\n\n**Recommendation:** use failure-inclusive average score in the main post.",
        timestamp: 7,
        metadata: {
          threadRefs: [{ threadKey: "q-1814", questId: "q-1814", source: "explicit" }],
          threadStatusMarkers: [makeThreadReadyStatus("a-reminder-resend", 7)],
        },
      }),
      makeMessage({ id: "u2", role: "user", content: "Point me to the artifacts", timestamp: 8 }),
    ];

    const model = buildFeedModel(messages, true);

    expect(model.turns).toHaveLength(2);
    expect(collapsedEntryIds(model.turns[0])).toEqual(["activity", "a-final-draft", "activity"]);
    expect(entryIds(model.turns[0].notificationEntries)).toEqual(["a-final-draft"]);
    expect(entryIds(model.turns[0].agentEntries)).toContain("a-reminder-resend");
  });

  it("keeps notification-backed checkpoints visible after model-only reminders", () => {
    // Checkpoints/needs-input prompts remain user-facing even when they follow a
    // reminder, and their ordinary waiting status should use existing rules.
    const checkpointMessage = makeVisibleLeaderMessage("a-checkpoint", "Checkpoint is ready for your decision.", 3);
    checkpointMessage.notification = {
      id: "needs-input-1",
      category: "needs-input",
      timestamp: 3,
      summary: "Choose the checkpoint path",
    };
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "coordinate checkpoint", timestamp: 1 }),
      makeInjectedUserMessage(
        "u-reminder",
        "[Thread outcome reminder] Missing outcome marker.",
        2,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      checkpointMessage,
      makeVisibleLeaderMessage("a-waiting", "Waiting on confirmation before dispatch.", 4),
    ];

    const model = buildFeedModel(messages, true);
    const turn = model.turns[0];

    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-checkpoint", "a-waiting"]);
    expect(entryIds(turn.notificationEntries)).toEqual(["a-checkpoint", "a-waiting"]);
    expect(entryIds(turn.agentEntries)).not.toContain("a-checkpoint");
  });
});

describe("explicit routed and Codex phase representative selection", () => {
  it("uses routed leader answer roles while keeping commentary as activity", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "summarize the result", timestamp: 1 }),
      makeRoutedLeaderAssistant("a-response", "Self-contained answer", 2, "answer"),
      makeRoutedLeaderAssistant("a-commentary", "Operational follow-up", 3, "commentary"),
    ];

    const mainTurn = buildFeedModel(messages, false, 0, undefined, undefined, undefined, true).turns[0];
    const selectedTurn = buildFeedModel(messages, true).turns[0];

    expect(mainTurn.responseEntry).toMatchObject({ kind: "message", msg: { id: "a-response" } });
    expect(entryIds(mainTurn.agentEntries)).toContain("a-commentary");
    expect(entryIds(selectedTurn.notificationEntries)).toEqual(["a-response"]);
    expect(entryIds(selectedTurn.agentEntries)).toContain("a-commentary");
  });

  it("chooses the last explicit answer over later commentary in ordinary turns", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "summarize the result", timestamp: 1 }),
      makePhasedAssistant("a-final-1", "First user-facing result", 2, "final_answer"),
      makePhasedAssistant("a-final-2", "Updated user-facing result", 3, "final_answer"),
      makeAssistantMessage("a-unknown-late", "Unannotated compatibility tail", 4),
      makePhasedAssistant("a-commentary", "Checking one last internal detail", 5, "commentary"),
    ];

    const turn = buildFeedModel(messages).turns[0];

    expect(turn.responseEntry).toMatchObject({ kind: "message", msg: { id: "a-final-2" } });
    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-final-2", "activity"]);
    expect(entryIds(turn.agentEntries)).toEqual(["a-final-1", "a-unknown-late", "a-commentary"]);
    expect(entryIds(turn.presentationEntries ?? [])).toEqual([
      "a-final-1",
      "a-final-2",
      "a-unknown-late",
      "a-commentary",
    ]);
  });

  it("uses compatibility fallback only for unknown messages when no final answer exists", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "continue", timestamp: 1 }),
      makePhasedAssistant("a-commentary", "Internal planning", 2, "commentary"),
      makePhasedAssistant("a-unknown", "Legacy user-facing answer", 3, null),
      makePhasedAssistant("a-later-commentary", "Internal cleanup", 4, "commentary"),
    ];

    const turn = buildFeedModel(messages).turns[0];

    expect(turn.responseEntry).toMatchObject({ kind: "message", msg: { id: "a-unknown" } });
    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-unknown", "activity"]);
  });

  it("keeps commentary-only ordinary turns as collapsed activity with no response representative", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "inspect the state", timestamp: 1 }),
      makePhasedAssistant("a-commentary-1", "Inspecting files", 2, "commentary"),
      makePhasedAssistant("a-commentary-2", "Checking tests", 3, "commentary"),
    ];

    const turn = buildFeedModel(messages).turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(collapsedEntryIds(turn)).toEqual(["activity"]);
    expect(entryIds(turn.presentationEntries ?? [])).toEqual(["a-commentary-1", "a-commentary-2"]);
  });

  it("falls back to the prior renderable unknown row when a final answer projects empty", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "show the answer", timestamp: 1 }),
      makeAssistantMessage("a-legacy", "Renderable compatibility answer", 2),
      makePhasedAssistant("a-empty-final", " \n\t ", 3, "final_answer"),
      makePhasedAssistant("a-commentary", "Internal follow-up", 4, "commentary"),
    ];

    const turn = buildFeedModel(messages).turns[0];

    expect(turn.responseEntry).toMatchObject({ kind: "message", msg: { id: "a-legacy" } });
    expect(entryIds(turn.presentationEntries ?? [])).not.toContain("a-empty-final");
    expect(entryIds(turn.allEntries)).toContain("a-empty-final");
  });

  it("promotes exactly one legacy phase answer while keeping unproven prose behind expansion", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "coordinate the quest", timestamp: 1 }),
      makeAssistantMessage("a-legacy", "Legacy progress before the final", 2),
      makePhasedAssistant("a-final-1", "Earlier user-facing result", 3, "final_answer"),
      makePhasedAssistant("a-final-2", "Latest user-facing result", 4, "final_answer"),
      makePhasedAssistant("a-commentary", "Internal cleanup after the result", 5, "commentary"),
      makeVisibleLeaderMessage("a-priority", "Published leader checkpoint", 6),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual(["a-final-2"]);
    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-final-2", "activity"]);
    expect(entryIds(turn.agentEntries)).toEqual(["a-legacy", "a-final-1", "a-commentary", "a-priority"]);
  });

  it("fails closed for selected leader finals when a bounded window omits the source boundary", () => {
    const annotated = buildFeedModel(
      [
        makePhasedAssistant("a-final", "Windowed final answer", 1, "final_answer"),
        makePhasedAssistant("a-commentary", "Windowed commentary", 2, "commentary"),
      ],
      true,
    ).turns[0];
    const injectedTail = buildFeedModel(
      [
        makeHerdEvent("herd-tail", "#2609 | turn_end | completed", 1),
        makePhasedAssistant("a-ready-tail", "Windowed Ready summary", 2, "final_answer", {
          threadStatusMarkers: [makeThreadReadyStatus("a-ready-tail", 2)],
        }),
      ],
      true,
    ).turns[0];
    const legacy = buildFeedModel([makeAssistantMessage("a-legacy", "Unanchored legacy tail", 1)], true).turns[0];

    expect(entryIds(annotated.notificationEntries)).toEqual([]);
    expect(collapsedEntryIds(annotated)).toEqual(["activity"]);
    expect(entryIds(injectedTail.notificationEntries)).toEqual([]);
    expect(collapsedEntryIds(injectedTail)).toEqual(["activity"]);
    expect(entryIds(injectedTail.allEntries)).toEqual(["herd-tail", "a-ready-tail"]);
    expect(entryIds(legacy.notificationEntries)).toEqual([]);
  });

  it("keeps the human-facing final in leader Main and All when a reminder emits a later final", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "prepare the report", timestamp: 1 }),
      makePhasedAssistant("a-user-final", "Authoritative report for the user", 2, "final_answer"),
      makeInjectedUserMessage(
        "u-reminder",
        "[Thread outcome reminder] Mark the touched thread.",
        3,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      makePhasedAssistant("a-reminder-final", "Acknowledged the reminder", 4, "final_answer"),
    ];

    const turn = buildFeedModel(messages, false, 0, undefined, undefined, undefined, true).turns[0];

    expect(turn.responseEntry).toMatchObject({ kind: "message", msg: { id: "a-user-final" } });
    expect(collapsedEntryIds(turn)).toEqual(["a-user-final", "activity"]);
  });

  it("keeps Main and All on one ordinary response across injected non-reminder segments", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "coordinate the report", timestamp: 1 }),
      makeAssistantMessage("a-first", "First response", 2),
      makeInjectedUserMessage("u-timer", "Check again.", 3, "timer:t1", "Timer t1"),
      makeAssistantMessage("a-second", "Second response", 4),
    ];

    const claudeTurn = buildFeedModel(messages).turns[0];
    const codexLeaderTurn = buildFeedModel(messages, false, 0, undefined, undefined, undefined, true).turns[0];

    expect(claudeTurn.responseEntry).toMatchObject({ kind: "message", msg: { id: "a-second" } });
    expect(codexLeaderTurn.responseEntry).toMatchObject({ kind: "message", msg: { id: "a-second" } });
    expect(entryIds(claudeTurn.notificationEntries)).toEqual([]);
    expect(entryIds(codexLeaderTurn.notificationEntries)).toEqual([]);
    expect(collapsedEntryIds(claudeTurn)).toEqual(collapsedEntryIds(codexLeaderTurn));
  });

  it("does not double-count a notification-backed final in leader Main and All", () => {
    const final = makePhasedAssistant("a-final", "Review is ready", 2, "final_answer");
    final.notification = { category: "review", summary: "Review is ready", timestamp: 2 };
    const turn = buildFeedModel(
      [makeMessage({ id: "u1", role: "user", content: "prepare review", timestamp: 1 }), final],
      false,
      0,
      undefined,
      undefined,
      undefined,
      true,
    ).turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(entryIds(turn.notificationEntries)).toEqual(["a-final"]);
    expect(turn.stats.messageCount).toBe(0);
  });

  it("fails closed for unanchored leader Main and All finals", () => {
    const turn = buildFeedModel(
      [makePhasedAssistant("a-unanchored-final", "Unknown requester", 1, "final_answer")],
      false,
      0,
      undefined,
      undefined,
      undefined,
      true,
    ).turns[0];

    expect(turn.responseEntry).toBeNull();
    expect(collapsedEntryIds(turn)).toEqual(["activity"]);
  });

  it("keeps final answers inside model-only reminder segments collapsed as activity", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "prepare the report", timestamp: 1 }),
      makePhasedAssistant("a-user-final", "Authoritative report for the user", 2, "final_answer"),
      makeInjectedUserMessage(
        "u-reminder",
        "[Thread outcome reminder] Mark the touched thread.",
        3,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      makePhasedAssistant("a-reminder-final", "Acknowledged the reminder", 4, "final_answer"),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual(["a-user-final"]);
    expect(collapsedEntryIds(turn)).toEqual(["a-user-final", "activity"]);
    expect(entryIds(turn.agentEntries)).toContain("a-reminder-final");
  });

  it("keeps a reminder-segment final visible only through an independent notification surface", () => {
    const priorityFinal = makePhasedAssistant("a-priority-final", "Review is ready", 4, "final_answer");
    priorityFinal.notification = { category: "review", summary: "Review is ready", timestamp: 4 };
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "prepare the report", timestamp: 1 }),
      makePhasedAssistant("a-user-final", "Authoritative report for the user", 2, "final_answer"),
      makeInjectedUserMessage(
        "u-reminder",
        "[Thread outcome reminder] Mark the touched thread.",
        3,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      priorityFinal,
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual(["a-user-final", "a-priority-final"]);
  });

  it("selects only the last legacy phase answer across injected leader segments", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "coordinate the report", timestamp: 1 }),
      makePhasedAssistant("a-first-final", "Initial user-facing report", 2, "final_answer"),
      makeInjectedUserMessage("u-timer", "Check the next report stage.", 3, "timer:t1", "Timer t1"),
      makePhasedAssistant("a-second-final", "Updated user-facing report", 4, "final_answer"),
      makeInjectedUserMessage(
        "u-reminder",
        "[Thread outcome reminder] Mark the touched thread.",
        5,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      makePhasedAssistant("a-reminder-final", "Reminder acknowledgement", 6, "final_answer"),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual(["a-second-final"]);
    expect(entryIds(turn.agentEntries)).toEqual(expect.arrayContaining(["a-first-final", "a-reminder-final"]));
  });

  it("keeps only the last phase-aware representative for a live-shaped legacy leader turn", () => {
    const waitingStatus = (messageId: string, timestamp: number) => ({
      kind: "waiting" as const,
      label: "Thread Waiting" as const,
      threadKey: "q-2031",
      questId: "q-2031",
      summary: "legacy work continues",
      messageId,
      timestamp,
      updatedAt: timestamp,
    });
    const readyStatus = {
      ...makeThreadReadyStatus("a-complete", 8),
      threadKey: "q-2031",
      questId: "q-2031",
      summary: "legacy work complete",
    };
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "add clearer collapse controls", timestamp: 1 }),
      makePhasedAssistant("a-setup", "Created and dispatched the follow-up quest.", 2, "final_answer", {
        threadStatusMarkers: [waitingStatus("a-setup", 2)],
      }),
      makeHerdEvent("herd-alignment", "#2609 | turn_end | alignment complete", 3),
      makePhasedAssistant("a-progress", "The worker is finishing the guarded transition.", 4, "final_answer", {
        threadStatusMarkers: [waitingStatus("a-progress", 4)],
      }),
      makeHerdEvent("herd-work", "#2609 | turn_end | Work complete", 5),
      makePhasedAssistant("a-commentary", "Checking the Memory handoff.", 6, "commentary"),
      makeHerdEvent("herd-memory", "#2609 | turn_end | Memory complete", 7),
      makePhasedAssistant(
        "a-complete",
        "Collapsed turns now have one unified footer.\n\n{[(Quest Quiz: q-2031)]}",
        8,
        "final_answer",
        { leaderThreadRole: "response", threadStatusMarkers: [readyStatus] },
      ),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual(["a-complete"]);
    expect(collapsedEntryIds(turn)).toEqual(["activity", "a-complete"]);
    expect(entryIds(turn.agentEntries)).toEqual(expect.arrayContaining(["a-setup", "a-progress", "a-commentary"]));
    expect(entryIds(turn.presentationEntries ?? [])).toEqual(
      expect.arrayContaining([
        "a-setup",
        "herd-alignment",
        "a-progress",
        "herd-work",
        "a-commentary",
        "herd-memory",
        "a-complete",
      ]),
    );
  });

  it("preserves explicit routed answers across injected leader segments", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "answer both follow-ups", timestamp: 1 }),
      makeRoutedLeaderAssistant("a-answer-1", "First explicit answer", 2, "answer"),
      makeHerdEvent("herd-1", "#2609 | turn_end | first follow-up", 3),
      makeRoutedLeaderAssistant("a-answer-2", "Second explicit answer", 4, "answer"),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual(["a-answer-1", "a-answer-2"]);
    expect(collapsedEntryIds(turn)).toEqual(["a-answer-1", "activity", "a-answer-2"]);
  });

  it("does not treat an unproven legacy response role as structural fallback evidence", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "prepare the report", timestamp: 1 }),
      makeMessage({
        id: "a-unproven-response",
        role: "assistant",
        content: "Legacy response-shaped row without matching proof",
        timestamp: 2,
        metadata: { leaderThreadRole: "response" },
      }),
      makeInjectedUserMessage(
        "u-reminder",
        "[Thread outcome reminder] Mark the touched thread.",
        3,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual([]);
    expect(collapsedEntryIds(turn)).toEqual(["activity"]);
    expect(entryIds(turn.agentEntries)).toContain("a-unproven-response");
  });

  it("keeps the pre-reminder fallback unknown-only and never promotes explicit commentary", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "u1", role: "user", content: "prepare the report", timestamp: 1 }),
      makeAssistantMessage("a-legacy", "Legacy report result", 2),
      makePhasedAssistant("a-commentary", "Internal note before reminder", 3, "commentary"),
      makeInjectedUserMessage(
        "u-reminder",
        "[Thread outcome reminder] Mark the touched thread.",
        4,
        THREAD_OUTCOME_REMINDER_SOURCE_ID,
        THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
      ),
      makePhasedAssistant("a-reminder-commentary", "Internal reminder acknowledgement", 5, "commentary"),
    ];

    const turn = buildFeedModel(messages, true).turns[0];

    expect(entryIds(turn.notificationEntries)).toEqual(["a-legacy"]);
    expect(entryIds(turn.notificationEntries)).not.toContain("a-commentary");
    expect(entryIds(turn.notificationEntries)).not.toContain("a-reminder-commentary");
  });

  it("does not promote explicit commentary as a sub-conclusion or needs-input segment preview", () => {
    const commentary = makePhasedAssistant(
      "a-commentary",
      "Recommendation: approve the internal draft after review.",
      2,
      "commentary",
    );
    const normalTurn = buildFeedModel([
      makeMessage({ id: "u1", role: "user", content: "run the worker", timestamp: 1 }),
      commentary,
      makeHerdEvent("h1", "#5 | turn_end | done", 3),
      makePhasedAssistant("a-final", "Worker-facing result", 4, "final_answer"),
    ]).turns[0];
    const leaderTurn = buildFeedModel(
      [
        makeMessage({ id: "u2", role: "user", content: "open a decision", timestamp: 1 }),
        commentary,
        makeNotifyToolMessage("a-notify", 3),
      ],
      true,
      0,
      ["a-notify"],
    ).turns[0];

    expect(normalTurn.subConclusions).toEqual([]);
    expect(collapsedEntryIds(leaderTurn)).toEqual(["activity", "a-notify"]);
    expect(entryIds(leaderTurn.agentEntries)).toContain("a-commentary");
  });
});
