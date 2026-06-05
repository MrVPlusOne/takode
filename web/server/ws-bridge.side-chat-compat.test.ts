import { describe, expect, it } from "vitest";
import type { WsBridge } from "./ws-bridge.js";

type LegacySideChatBridgeAliases = Pick<
  WsBridge,
  "syncSlackThreadRecord" | "syncSlackThreadRecordForChild" | "routeSlackThreadUserMessage"
>;

describe("WsBridge Side Chat compatibility aliases", () => {
  it("keeps deprecated SlackThread helper methods in the public type surface", () => {
    const acceptsLegacyAliases = (_bridge: LegacySideChatBridgeAliases) => true;

    expect(typeof acceptsLegacyAliases).toBe("function");
  });
});
