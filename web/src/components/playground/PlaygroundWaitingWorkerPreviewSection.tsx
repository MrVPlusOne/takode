import type { SessionActivityPreview } from "../../../server/session-activity-preview.js";
import type { LeaderThreadStatus } from "../../../shared/thread-status-marker.js";
import { TurnThreadStatusFooter } from "../MessageFeedThreadStatus.js";
import { WaitingWorkerPreviewPanel, type WaitingWorkerTarget } from "../WaitingWorkerPreview.js";
import type { ToolMsgGroup } from "../../hooks/use-feed-model.js";
import { CompactToolMessageGroups } from "../ToolMessageGroup.js";
import { PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.now();
const MINUTE = 60_000;

const WORKING: WaitingWorkerTarget = {
  questId: "q-101",
  workerSessionId: "playground-worker",
  workerNum: 2781,
  workerStatus: "running",
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
}: {
  target: WaitingWorkerTarget;
  preview: SessionActivityPreview;
  summary: string;
}) {
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
        <WaitingWorkerPreviewPanel target={target} preview={preview} now={NOW} onOpenSession={() => {}} />
      </div>
    </div>
  );
}

export function PlaygroundWaitingWorkerPreviewSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Waiting Worker Preview"
        description="Part of the chat feed under the Thread Waiting status while a quest thread waits on its worker: working (pulsing dot, no status pill) and idle-while-waiting (idle pill with time since the last activity). The title bar shows only the worker number and Open session; the quest header carries machine and phase. A status-keyed left edge (green while working) sets it apart from the leader's own activity group above."
      >
        <div className="space-y-4" data-testid="playground-waiting-worker-preview">
          <FeedFooterDemo target={WORKING} preview={WORKING_PREVIEW} summary="#2781 implementing the preview" />
          <FeedFooterDemo
            target={{ ...WORKING, workerStatus: "idle" }}
            preview={IDLE_PREVIEW}
            summary="#2781 running the full suite"
          />
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
