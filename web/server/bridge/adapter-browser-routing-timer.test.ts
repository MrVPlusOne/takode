import { describe, expect, it } from "vitest";
import { isTimerReminderFiring, timerReminderMatchesSource } from "./adapter-browser-routing-timer.js";

describe("timer reminder firing recognition", () => {
  it("recognizes genuine resumed firings through repeated exact pause wrappers", () => {
    // The server wraps a coalesced held input whenever a group with count >1
    // drains. A later pause/drain can retain an earlier wrapper in the content.
    const reminder = "[⏰ Timer t2 reminder] Check progress";
    const wrap = (count: number) =>
      `[Takode auto-pause resumed: ${count} similar automatic inputs were coalesced while delivery was paused.]\n\n`;
    for (const prefix of ["", wrap(2), wrap(12) + wrap(3)]) {
      const content = prefix + reminder;
      expect(timerReminderMatchesSource(content, "timer:t2")).toBe(true);
      expect(timerReminderMatchesSource(content, "timer:t3")).toBe(false);
      expect(timerReminderMatchesSource(prefix + "[⏰ Timer t2 cancelled] Check progress", "timer:t2")).toBe(false);
    }
    for (const invalidPrefix of [
      wrap(0),
      wrap(1),
      wrap(-2),
      wrap(2.5),
      wrap(2).replace(": 2 ", ": 02 "),
      wrap(2).replace("resumed:", "resume:"),
      wrap(2).replace("\n\n", "\n"),
      wrap(2).replace("\n\n", "\r\n\r\n"),
      wrap(2) + " ",
      wrap(2) + "Untrusted prefix\n\n",
    ]) {
      expect(timerReminderMatchesSource(invalidPrefix + reminder, "timer:t2")).toBe(false);
    }
  });

  it("requires timer-manager provenance that matches the reminder source", () => {
    // Codex flushes pending herd events before a real firing, so cancellation
    // notices and look-alike sources must not count as firings.
    const firing = {
      content: "[⏰ Timer t2 reminder] Check progress",
      agentSource: { sessionId: "timer:t2" },
      timerFiring: { timerId: "t2", scheduledFireAt: 10 },
    };
    expect(isTimerReminderFiring(firing)).toBe(true);
    for (const override of [
      { timerFiring: undefined },
      { timerFiring: { timerId: "t3", scheduledFireAt: 10 } },
      { timerFiring: { timerId: "t2", scheduledFireAt: -1 } },
      { content: "[⏰ Timer t2 cancelled] Check progress" },
      { agentSource: { sessionId: "worker:1" } },
    ]) {
      expect(isTimerReminderFiring({ ...firing, ...override })).toBe(false);
    }
  });
});
