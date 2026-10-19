import { describe, expect, it } from "vitest";
import { MESSAGE_TIME_CLUSTER_MS, hiddenMessageTimeLabels } from "./message-time-labels.js";

const MINUTE = 60_000;
const at = (minutes: number) => 1_000_000_000_000 + minutes * MINUTE;

describe("hiddenMessageTimeLabels", () => {
  it("hides an older label when the next message on the same side is under the cluster gap later", () => {
    // Two quick assistant messages: only the newer one keeps its time.
    const hidden = hiddenMessageTimeLabels([
      { id: "a1", side: "assistant", timestamp: at(0) },
      { id: "a2", side: "assistant", timestamp: at(2) },
    ]);
    expect([...hidden]).toEqual(["a1"]);
  });

  it("keeps both labels once messages are at least the cluster gap apart", () => {
    const hidden = hiddenMessageTimeLabels([
      { id: "a1", side: "assistant", timestamp: at(0) },
      { id: "a2", side: "assistant", timestamp: at(0) + MESSAGE_TIME_CLUSTER_MS },
    ]);
    expect(hidden.size).toBe(0);
  });

  it("measures against the next label shown, so a long chain of close messages still gets periodic times", () => {
    // Every message is 1 minute after the previous one. Measuring only against the
    // immediate neighbour would hide everything but the last; instead no visible label
    // is ever 3 or more minutes away from a hidden message it covers.
    const entries = [0, 1, 2, 3, 4, 5, 6].map((minute) => ({
      id: `u${minute}`,
      side: "user" as const,
      timestamp: at(minute),
    }));
    const hidden = hiddenMessageTimeLabels(entries);
    expect(entries.filter((entry) => !hidden.has(entry.id)).map((entry) => entry.id)).toEqual(["u0", "u3", "u6"]);
  });

  it("starts a new run when the other side speaks in between", () => {
    // A user message between two close answers keeps all three labels: each side reads
    // its own times, and adjacent messages on different sides are not clustered.
    const hidden = hiddenMessageTimeLabels([
      { id: "a1", side: "assistant", timestamp: at(0) },
      { id: "u1", side: "user", timestamp: at(1) },
      { id: "a2", side: "assistant", timestamp: at(2) },
    ]);
    expect(hidden.size).toBe(0);
  });

  it("orders by time, not by registration order", () => {
    const hidden = hiddenMessageTimeLabels([
      { id: "newer", side: "assistant", timestamp: at(1) },
      { id: "older", side: "assistant", timestamp: at(0) },
    ]);
    expect([...hidden]).toEqual(["older"]);
  });
});
