import { describe, expect, it, vi } from "vitest";
import { broadcastQuestUpdate } from "./quest-helpers.js";

describe("broadcastQuestUpdate", () => {
  it("routes quest invalidations through the global non-buffering fanout path", () => {
    const broadcastGlobal = vi.fn();
    const broadcastToBrowsers = vi.fn();
    const wsBridge = {
      broadcastGlobal,
      broadcastToBrowsers,
      sessions: new Map([["s1", {}]]),
    };

    broadcastQuestUpdate(wsBridge as unknown as Parameters<typeof broadcastQuestUpdate>[0]);

    expect(broadcastGlobal).toHaveBeenCalledTimes(1);
    expect(broadcastGlobal).toHaveBeenCalledWith({ type: "quest_list_updated" });
    expect(broadcastToBrowsers).not.toHaveBeenCalled();
  });
});
