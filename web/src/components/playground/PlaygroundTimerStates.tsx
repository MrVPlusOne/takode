import { useStore } from "../../store.js";
import type { SdkSessionInfo } from "../../types.js";
import { WaitingChip } from "../WaitingChip.js";
import { Card, Section, TimerModalDemo } from "./shared.js";

/** A Claude session waiting on a background job and a test-slot queue besides its timers. */
function seedServerWaits(withWaits: boolean) {
  const now = Date.now();
  const session: SdkSessionInfo = {
    sessionId: "playground-timers",
    state: "connected",
    cwd: "/repo/takode",
    createdAt: now - 3_600_000,
    backendType: "claude-sdk",
    waits: withWaits
      ? [
          { kind: "job", description: "classify all 1,600 tasks", startedAt: now - 12 * 60_000 },
          { kind: "queue", resource: "full-suite:takode@devbox", position: 2 },
        ]
      : [],
  };
  useStore.setState((state) => ({
    sdkSessions: [...state.sdkSessions.filter((candidate) => candidate.sessionId !== session.sessionId), session],
  }));
}

export function PlaygroundTimerStates() {
  return (
    <Section
      title="Waiting Chip + List"
      description="Floating glassmorphic chip (like Purring indicator) naming what the session waits on, with that wait's icon: the leading server-reported wait (the user's answer, a background job with its run time, a landing run, a queue place), else the soonest timer, plus a count of the rest. Tapping lists them all, timers with their cancel controls."
    >
      <div className="max-w-3xl space-y-4">
        <Card label="Waiting chip (floating pill)">
          <div className="p-3 space-y-2">
            <button
              type="button"
              onClick={() => {
                const now = Date.now();
                seedServerWaits(false);
                useStore.setState({
                  sessionTimers: new Map([
                    [
                      "playground-timers",
                      [
                        {
                          id: "t1",
                          sessionId: "playground-timers",
                          title: "Check build status",
                          description: "inspect the latest build status and report back",
                          type: "delay" as const,
                          originalSpec: "30m",
                          nextFireAt: now + 1_800_000,
                          createdAt: now - 600_000,
                          fireCount: 0,
                        },
                        {
                          id: "t2",
                          sessionId: "playground-timers",
                          title: "Refresh context",
                          description: "re-read changed files and summarize what moved",
                          type: "recurring" as const,
                          originalSpec: "10m",
                          nextFireAt: now + 360_000,
                          intervalMs: 600_000,
                          createdAt: now - 1_200_000,
                          lastFiredAt: now - 600_000,
                          fireCount: 3,
                        },
                        {
                          id: "t3",
                          sessionId: "playground-timers",
                          title: "Deploy reminder",
                          description: "make sure the staging build passed CI before promoting to production",
                          type: "at" as const,
                          originalSpec: "3pm",
                          nextFireAt: now + 7_200_000,
                          createdAt: now - 300_000,
                          fireCount: 0,
                        },
                      ],
                    ],
                  ]),
                });
              }}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition-colors cursor-pointer"
            >
              Seed timer data
            </button>
            <button
              type="button"
              onClick={() => seedServerWaits(true)}
              className="ml-2 text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors cursor-pointer"
            >
              Add job + queue waits
            </button>
            <div className="relative h-24 rounded-lg border border-cc-border bg-cc-bg overflow-hidden">
              <div className="absolute bottom-2 right-2">
                <WaitingChip sessionId="playground-timers" />
              </div>
            </div>
            <p className="text-[10px] text-cc-muted">
              Click "Seed timer data" first: the chip shows the soonest timer's countdown and "+2" for the others. "Add
              job + queue waits" makes the background job lead, with its run time, and "+4". Click the chip to list
              every wait, timers with untruncated prompt text and cancel controls.
            </p>
          </div>
        </Card>

        <Card label="Waiting list (standalone)">
          <div className="p-3 space-y-2">
            <TimerModalDemo />
            <p className="text-[10px] text-cc-muted">
              Opens the waiting list. Seed data above first to see entries. Shows server-reported waits, then timers
              with full prompt text, type, countdown, and per-timer cancel button.
            </p>
          </div>
        </Card>
      </div>
    </Section>
  );
}
