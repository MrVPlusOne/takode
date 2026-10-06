import { useState } from "react";
import type { SessionActivityPreview } from "../../../server/session-activity-preview.js";
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
      text: "The panel sits between the feed and the composer.",
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

function PanelDemo({
  target,
  preview,
  initiallyCollapsed,
}: {
  target: WaitingWorkerTarget;
  preview: SessionActivityPreview;
  initiallyCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  return (
    <div className="max-w-4xl overflow-hidden rounded-xl border border-cc-border bg-cc-bg">
      <div className="px-4 py-3 text-xs text-cc-muted">… latest leader message and Thread Waiting chip …</div>
      <WaitingWorkerPreviewPanel
        target={target}
        preview={preview}
        collapsed={collapsed}
        now={NOW}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onOpenSession={() => {}}
      />
      <div className="border-t border-cc-border bg-cc-card px-4 py-3 text-xs text-cc-muted">Composer</div>
    </div>
  );
}

export function PlaygroundWaitingWorkerPreviewSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Waiting Worker Preview"
        description="Pinned above the composer while a quest thread waits on its worker: expanded, collapsed, and idle-while-waiting."
      >
        <div className="space-y-4" data-testid="playground-waiting-worker-preview">
          <PanelDemo target={WORKING} preview={WORKING_PREVIEW} initiallyCollapsed={false} />
          <PanelDemo target={WORKING} preview={WORKING_PREVIEW} initiallyCollapsed />
          <PanelDemo
            target={{ ...WORKING, workerStatus: "idle", phaseStartedAt: NOW - 42 * MINUTE }}
            preview={IDLE_PREVIEW}
            initiallyCollapsed={false}
          />
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
