import { useState } from "react";
import type { SessionActivityPreview } from "../../../server/session-activity-preview.js";
import type { LeaderThreadStatus } from "../../../shared/thread-status-marker.js";
import { TurnThreadStatusFooter } from "../MessageFeedThreadStatus.js";
import {
  WaitingWorkerPreviewPanel,
  autoSelectedSessionId,
  type WaitingSession,
  type WaitingWorkerTarget,
} from "../WaitingWorkerPreview.js";
import type { ToolMsgGroup } from "../../hooks/use-feed-model.js";
import { CompactToolMessageGroups } from "../ToolMessageGroup.js";
import { MessageBubble } from "../MessageBubble.js";
import type { ChatMessage } from "../../types.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.now();
const MINUTE = 60_000;

const OWNER: WaitingSession = {
  sessionId: "playground-worker",
  sessionNum: 2781,
  status: "running",
  turnStartedAt: NOW - 12 * MINUTE - 34_000,
  helper: false,
};
const IDLE_OWNER: WaitingSession = { ...OWNER, status: "idle", turnStartedAt: null };

const WORKING: WaitingWorkerTarget = { questId: "q-101", sessions: [OWNER], ownerWaits: [] };
const IDLE: WaitingWorkerTarget = { ...WORKING, sessions: [IDLE_OWNER] };

// The owner waits idle while a helper on another machine runs the step it cannot.
const WITH_HELPER: WaitingWorkerTarget = {
  questId: "q-101",
  sessions: [
    IDLE_OWNER,
    {
      sessionId: "playground-helper",
      sessionNum: 2790,
      status: "running",
      turnStartedAt: NOW - 3 * MINUTE - 8_000,
      helper: true,
    },
  ],
  ownerWaits: ["#2790"],
};

const HELPER_PREVIEW: SessionActivityPreview = {
  lines: [
    {
      historyIndex: 12,
      kind: "tool",
      toolName: "Bash",
      text: "Paste the sample into the Slack self-DM",
      timestamp: NOW - 90_000,
    },
    {
      historyIndex: 13,
      kind: "tool",
      toolName: "Bash",
      text: "Paste the sample into TextEdit",
      timestamp: NOW - 60_000,
    },
    {
      historyIndex: 14,
      kind: "message",
      text: "Both pastes keep the bold text and the list.",
      timestamp: NOW - 30_000,
    },
    { historyIndex: 15, kind: "tool", toolName: "Read", text: "slack-paste.png", timestamp: NOW - 4_000 },
  ],
  lastActivityAt: NOW - 4_000,
};

const WORKING_PREVIEW: SessionActivityPreview = {
  lines: [
    {
      historyIndex: 40,
      kind: "message",
      text: "The preview sits under the Waiting status in the feed.",
      timestamp: NOW - 50_000,
    },
    { historyIndex: 41, kind: "tool", toolName: "Edit", text: "ChatView.tsx", timestamp: NOW - 30_000 },
    { historyIndex: 42, kind: "tool", toolName: "Bash", text: "Run focused component tests", timestamp: NOW - 12_000 },
    { historyIndex: 43, kind: "tool", toolName: "Read", text: "WaitingWorkerPreview.test.tsx", timestamp: NOW - 2_000 },
  ],
  lastActivityAt: NOW - 2_000,
};

const IDLE_PREVIEW: SessionActivityPreview = {
  lines: [
    {
      historyIndex: 88,
      kind: "tool",
      toolName: "Bash",
      text: "Start the full test suite in the background",
      timestamp: NOW - 9 * MINUTE,
    },
    {
      historyIndex: 89,
      kind: "message",
      text: "Waiting for the background test run to finish.",
      timestamp: NOW - 8 * MINUTE,
    },
  ],
  lastActivityAt: NOW - 8 * MINUTE,
};

// A watching worker whose checks found nothing: its quiet turns did not wake the leader.
const QUIET_PREVIEW: SessionActivityPreview = {
  lines: [
    {
      historyIndex: 120,
      kind: "tool",
      toolName: "Bash",
      text: "Check the PR for new comments",
      timestamp: NOW - 41 * MINUTE,
    },
    { historyIndex: 121, kind: "quiet", text: "1 PM check: no reply yet", timestamp: NOW - 40 * MINUTE },
    {
      historyIndex: 130,
      kind: "tool",
      toolName: "Bash",
      text: "Check the PR for new comments",
      timestamp: NOW - 21 * MINUTE,
    },
    {
      historyIndex: 131,
      kind: "quiet",
      text: "1:20 PM check: no reply yet; next check at 1:40",
      timestamp: NOW - 20 * MINUTE,
    },
  ],
  lastActivityAt: NOW - 20 * MINUTE,
};

// The worker's own feed: the quiet marker line becomes a note under the message.
const QUIET_WORKER_MESSAGE: ChatMessage = {
  id: "playground-quiet-worker-message",
  role: "assistant",
  content: "No new comments on the PR since 1 PM.\n\n{[(Quiet: 1:20 PM check: no reply yet; next check at 1:40)]}",
  contentBlocks: [
    {
      type: "text",
      text: "No new comments on the PR since 1 PM.\n\n{[(Quiet: 1:20 PM check: no reply yet; next check at 1:40)]}",
    },
  ],
  timestamp: NOW - 20 * MINUTE,
};

// The leader's own activity just before the preview: the same faint card, so the
// preview's status edge is what tells the two apart.
const LEADER_ACTIVITY: ToolMsgGroup = {
  kind: "tool_msg_group",
  toolName: "Bash",
  firstId: "playground-leader-activity",
  items: ["Find the quest's open feedback", "Record the user decision", "Dispatch the worker"].map(
    (description, index) => ({
      id: `playground-leader-activity-${index + 1}`,
      name: "Bash",
      input: { command: `quest show q-101 # ${index + 1}`, description },
      messageId: "playground-leader-activity",
    }),
  ),
};

function waitingStatus(summary: string): LeaderThreadStatus {
  return {
    kind: "waiting",
    label: "Thread Waiting",
    threadKey: "q-101",
    questId: "q-101",
    summary,
    messageId: "playground-waiting-status",
    timestamp: NOW,
    updatedAt: NOW,
  };
}

/** Same footer layout as the feed: the Waiting chip, then the worker preview under it. */
function FeedFooterDemo({
  target,
  preview,
  summary,
  waitingFor = null,
}: {
  target: WaitingWorkerTarget;
  /** Activity per session ID; one preview serves every session when there is only one. */
  preview: SessionActivityPreview | Record<string, SessionActivityPreview>;
  summary: string;
  waitingFor?: string | null;
}) {
  const [selected, setSelected] = useState(() => autoSelectedSessionId(target.sessions));
  const shown = Array.isArray(preview.lines)
    ? (preview as SessionActivityPreview)
    : (preview as Record<string, SessionActivityPreview>)[selected]!;
  return (
    <div className="max-w-3xl space-y-2 rounded-xl border border-cc-border bg-cc-bg px-3 py-4 sm:px-6">
      <div className="pl-9">
        <CompactToolMessageGroups
          groups={[LEADER_ACTIVITY]}
          sessionId="playground-waiting-leader"
          isCodexSession={false}
          activeCodexTerminalIds={new Set()}
          onOpenCodexTerminal={() => {}}
        />
      </div>
      <div className="pl-9 text-sm text-cc-fg/85">
        I sent #2781 to build the preview. I'll check back when it reports.
      </div>
      <TurnThreadStatusFooter statuses={[waitingStatus(summary)]} currentThreadKey="q-101" />
      <div className="pl-9">
        <WaitingWorkerPreviewPanel
          target={target}
          selectedSessionId={selected}
          onSelectSession={setSelected}
          waitingFor={selected === target.sessions[0]?.sessionId ? waitingFor : null}
          preview={shown}
          now={NOW}
          onOpenSession={() => {}}
        />
      </div>
    </div>
  );
}

export function PlaygroundWaitingWorkerPreviewSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Waiting Worker Preview"
        description="Part of the chat feed under the Thread Waiting status while a quest thread waits on its worker: working (pulsing dot and a live timer of the worker's current turn, no status pill), idle-while-waiting (the pill names what the worker waits for, with time since its last activity), idle with quiet turns (each quiet line is a turn the worker marked quiet, which did not wake the leader), and an owner waiting on a helper session: the row's helpers share the title bar as tabs, the preview switches to whichever session last started working, and a tapped tab stays until that changes. The title bar shows only the worker number, its turn timer while working, and Open session; the quest header carries machine and phase. A status-keyed left edge (green while working) sets it apart from the leader's own activity group above."
      >
        <div className="space-y-4" data-testid="playground-waiting-worker-preview">
          <FeedFooterDemo target={WORKING} preview={WORKING_PREVIEW} summary="#2781 implementing the preview" />
          <FeedFooterDemo
            target={IDLE}
            preview={IDLE_PREVIEW}
            summary="#2781 running the full suite"
            waitingFor='background job "Run the full test suite"'
          />
          <FeedFooterDemo target={IDLE} preview={QUIET_PREVIEW} summary="#2781 watching the PR for a reply" />
          <FeedFooterDemo
            target={WITH_HELPER}
            preview={{ "playground-worker": IDLE_PREVIEW, "playground-helper": HELPER_PREVIEW }}
            summary="q-101 helper running the paste test"
            waitingFor="#2790"
          />
        </div>
      </Section>
      <Section
        title="Quiet Worker Turn"
        description="A worker message that ended with the quiet marker: the raw marker line is hidden and its summary shows as a quiet note, so the reader knows this turn did not wake the leader."
      >
        <Card label="Worker message marked quiet">
          <MessageBubble message={QUIET_WORKER_MESSAGE} />
        </Card>
      </Section>
    </PlaygroundSectionGroup>
  );
}
