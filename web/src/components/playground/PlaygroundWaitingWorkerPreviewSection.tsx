import type { SessionActivityPreview } from "../../../server/session-activity-preview.js";
import type { LeaderThreadStatus } from "../../../shared/thread-status-marker.js";
import { TurnThreadStatusFooter } from "../MessageFeedThreadStatus.js";
import { WaitingWorkerPreviewPanel, type WaitingWorkerTarget } from "../WaitingWorkerPreview.js";
import { PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.now();
const MINUTE = 60_000;

const WORKING: WaitingWorkerTarget = {
  questId: "q-101",
  workerSessionId: "playground-worker",
  workerNum: 2781,
  workerStatus: "running",
  phaseLabel: "Work",
  phaseStartedAt: NOW - 14 * MINUTE,
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
        description="Part of the chat feed under the Thread Waiting status while a quest thread waits on its worker: working and idle-while-waiting."
      >
        <div className="space-y-4" data-testid="playground-waiting-worker-preview">
          <FeedFooterDemo target={WORKING} preview={WORKING_PREVIEW} summary="#2781 implementing the preview" />
          <FeedFooterDemo
            target={{ ...WORKING, workerStatus: "idle", phaseStartedAt: NOW - 42 * MINUTE }}
            preview={IDLE_PREVIEW}
            summary="#2781 running the full suite"
          />
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
