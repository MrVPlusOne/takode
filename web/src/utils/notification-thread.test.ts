import { describe, expect, it } from "vitest";
import { isNotificationOwnerSelected, resolveNotificationOwnerThreadKey } from "./notification-thread.js";

describe("notification thread ownership", () => {
  it("uses a valid notification thread key as the owner", () => {
    expect(resolveNotificationOwnerThreadKey({ threadKey: "q-977", questId: "q-977" })).toBe("q-977");
    expect(isNotificationOwnerSelected({ threadKey: "q-977" }, "q-977")).toBe(true);
  });

  it("treats All Threads as a projection, not an owner match", () => {
    expect(resolveNotificationOwnerThreadKey({ threadKey: "all", questId: "q-977" })).toBe("main");
    expect(isNotificationOwnerSelected({ threadKey: "q-977" }, "all")).toBe(false);
  });

  it("falls back to Main when ownership cannot be resolved", () => {
    expect(resolveNotificationOwnerThreadKey({ threadKey: "weird" })).toBe("main");
    expect(resolveNotificationOwnerThreadKey(null)).toBe("main");
  });
});
