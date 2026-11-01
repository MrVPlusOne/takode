import { afterEach, describe, expect, it } from "vitest";
import { normalizeThreadTarget, parseThreadTextPrefix, formatThreadMarker } from "./thread-routing.js";
import { parseThreadStatusMarkerLine } from "./thread-status-marker.js";
import {
  isThreadNumberKey,
  normalizeTopicKey,
  rememberThreadNumbers,
  resetThreadNumbersForTest,
  threadAddress,
  topicIdOfViewKey,
} from "./topic-thread-key.js";

/**
 * Threads have short addresses (`t-17`), numbered like quests across every leader. Internally a
 * thread stays keyed by its handle (`topic:<handle>`, still accepted as an alias); `t-N` resolves
 * to that key wherever a thread is named, and thread keys are written back as `t-N`.
 */
describe("thread addresses (t-N)", () => {
  afterEach(() => resetThreadNumbersForTest());

  it("resolves a known address to its thread's key and writes the key back as its address", () => {
    rememberThreadNumbers([[17, "8df94bcb-1111-4222-8333-444455556666"]]);
    expect(topicIdOfViewKey("t-17")).toBe("8df94bcb");
    expect(topicIdOfViewKey(" T-17 ")).toBe("8df94bcb");
    expect(normalizeTopicKey("t-17")).toBe("topic:8df94bcb");
    expect(threadAddress("topic:8df94bcb")).toBe("t-17");
    // Other keys are written as they are; so is a handle whose number isn't known here.
    expect(threadAddress("Q-42")).toBe("q-42");
    expect(threadAddress("main")).toBe("main");
    expect(threadAddress("topic:aa11bb22")).toBe("topic:aa11bb22");
  });

  it("keeps an address no thread has as written, so it is reported as unknown rather than dropped", () => {
    expect(isThreadNumberKey("t-9")).toBe(true);
    expect(isThreadNumberKey("t-")).toBe(false);
    expect(isThreadNumberKey("tq-9")).toBe(false);
    expect(topicIdOfViewKey("t-9")).toBeNull();
    expect(normalizeThreadTarget("t-9")).toEqual({ threadKey: "t-9" });
    expect(normalizeThreadTarget("t-x")).toBeNull();
  });

  it("routes markers, status lines and targets written with an address to the thread's key", () => {
    rememberThreadNumbers([[3, "6fd2c4bb"]]);
    expect(normalizeThreadTarget("t-3")).toEqual({ threadKey: "topic:6fd2c4bb" });
    // The older handle form keeps working as an alias.
    expect(normalizeThreadTarget("topic:6fd2c4bb")).toEqual({ threadKey: "topic:6fd2c4bb" });
    expect(parseThreadTextPrefix("[thread:t-3:A:u4]\nDone")).toEqual({
      ok: true,
      target: { threadKey: "topic:6fd2c4bb" },
      role: "answer",
      answerUserMessageIds: ["u4"],
      body: "Done",
    });
    expect(parseThreadStatusMarkerLine("{[(Thread Ready: t-3 | answered)]}")).toMatchObject({
      target: { threadKey: "topic:6fd2c4bb" },
    });
    // Markers Takode writes (for example message headers) use the address.
    expect(formatThreadMarker("topic:6fd2c4bb", "commentary")).toBe("[thread:t-3:C]");
    expect(formatThreadMarker("topic:6fd2c4bb", "answer", ["u1"], { urgent: true })).toBe("[thread:t-3:A!:u1]");
  });
});
