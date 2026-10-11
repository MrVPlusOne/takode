import { describe, expect, it } from "vitest";
import type { ActivityThread } from "../server/activity-stream.js";
import { formatActivity, parseActivityTime } from "./takode-activity.js";

describe("parseActivityTime", () => {
  const now = new Date(2026, 9, 11, 15, 30).getTime();

  it("reads durations ago, local midnights, local dates and epoch milliseconds", () => {
    expect(parseActivityTime("6h", now)).toBe(now - 6 * 3_600_000);
    expect(parseActivityTime("30m", now)).toBe(now - 30 * 60_000);
    expect(parseActivityTime("2d", now)).toBe(now - 2 * 86_400_000);
    expect(parseActivityTime("today", now)).toBe(new Date(2026, 9, 11).getTime());
    expect(parseActivityTime("yesterday", now)).toBe(new Date(2026, 9, 10).getTime());
    // A bare date means local midnight, not UTC midnight.
    expect(parseActivityTime("2026-10-10", now)).toBe(new Date(2026, 9, 10).getTime());
    expect(parseActivityTime("2026-10-10T09:15", now)).toBe(new Date(2026, 9, 10, 9, 15).getTime());
    expect(parseActivityTime("1791700000000", now)).toBe(1791700000000);
  });
});

describe("formatActivity", () => {
  const at = new Date(2026, 9, 10, 9, 0).getTime();
  const leaderThread: ActivityThread = {
    session: 12,
    sessionId: "leader",
    sessionName: "Takode leader",
    space: "Takode",
    thread: "q-5",
    messages: [
      { role: "user", index: 3, at, text: "Fix the sidebar" },
      { role: "user", index: 4, at, text: "And the\n\ntop bar", images: 1 },
      { role: "answer", index: 6, at, text: "Top bar fixed.", to: [4], chars: 900 },
      { role: "answer", index: 8, at, text: "Sidebar fixed too.", to: [3] },
      { role: "user", index: 9, at, text: "Thanks" },
    ],
  };
  const workerThread: ActivityThread = {
    session: 20,
    sessionId: "worker",
    sessionName: "Worker",
    space: "MSI",
    messages: [
      { role: "user", index: 1, at, text: "Run it" },
      { role: "answer", index: 2, at, text: "Done.", to: [1] },
    ],
  };

  it("names the messages an answer answers only when they are not the open ones just above it", () => {
    const text = formatActivity({ since: at, until: at + 1, spaces: ["Takode"], threads: [leaderThread] }, false);
    const lines = text.split("\n");

    expect(lines[0]).toContain("space Takode · 3 user messages (1 unanswered)");
    expect(lines).toContain("#12 Takode leader · q-5");
    // [6] answers only [4] of the two open messages, so it names it; [8] then answers
    // the one left open, which needs no note.
    expect(lines.find((line) => line.includes("answer [6]"))).toMatch(
      /answer \[6\] \(to 4, 900 chars\): Top bar fixed\.$/,
    );
    expect(lines.find((line) => line.includes("answer [8]"))).toMatch(/answer \[8\]: Sidebar fixed too\.$/);
    expect(lines.find((line) => line.includes("user [4]"))).toMatch(/user \[4\] \(1 image\): And the top bar$/);
    expect(lines.find((line) => line.includes("user [9]"))).toMatch(/user \[9\] \(unanswered\): Thanks$/);
  });

  it("shows each thread's space when several spaces are listed, and whole multi-line messages with --full", () => {
    const text = formatActivity(
      { since: at, until: at + 1, spaces: null, threads: [leaderThread, workerThread] },
      true,
    );

    expect(text).toContain("all spaces");
    expect(text).toContain("#12 Takode leader [Takode] · q-5");
    expect(text).toContain("#20 Worker [MSI]");
    expect(text).toContain("user [4] (1 image):\n    And the\n    \n    top bar");
    expect(text).not.toContain("Whole messages: --full");
  });
});
