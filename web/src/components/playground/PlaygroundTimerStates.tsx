import { useStore } from "../../store.js";
import { TimerChip } from "../TimerWidget.js";
import { Card, Section, TimerModalDemo } from "./shared.js";

export function PlaygroundTimerStates() {
  return (
    <Section
      title="Timer Chip + Modal"
      description="Floating glassmorphic chip (like Purring indicator) that opens a modal with full timer details."
    >
      <div className="max-w-3xl space-y-4">
        <Card label="Timer chip (floating pill)">
          <div className="p-3 space-y-2">
            <button
              type="button"
              onClick={() => {
                const now = Date.now();
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
            <div className="relative h-24 rounded-lg border border-cc-border bg-cc-bg overflow-hidden">
              <div className="absolute bottom-2 right-2">
                <TimerChip sessionId="playground-timers" />
              </div>
            </div>
            <p className="text-[10px] text-cc-muted">
              Click "Seed timer data" first. The chip shows timer count and next fire time as a glassmorphic pill. Click
              the chip to open the full modal with untruncated prompt text and cancel controls.
            </p>
          </div>
        </Card>

        <Card label="Timer modal (standalone)">
          <div className="p-3 space-y-2">
            <TimerModalDemo />
            <p className="text-[10px] text-cc-muted">
              Opens the timer detail modal. Seed timer data above first to see entries. Shows full prompt text, timer
              type, countdown, and per-timer cancel button.
            </p>
          </div>
        </Card>
      </div>
    </Section>
  );
}
