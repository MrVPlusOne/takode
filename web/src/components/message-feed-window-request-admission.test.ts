import { describe, expect, it, vi } from "vitest";
import { admitSectionWindowRequest } from "./message-feed-window-request-admission.js";

describe("admitSectionWindowRequest", () => {
  it("does not mark loading when disconnected delivery declines", () => {
    const markPending = vi.fn(() => true);
    const send = vi.fn(() => false);

    expect(
      admitSectionWindowRequest({
        direction: "older",
        requestKey: "history:0:8",
        pendingRequestKey: null,
        send,
        markPending,
      }),
    ).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    expect(markPending).not.toHaveBeenCalled();
  });

  it("marks loading only after connected delivery accepts the request", () => {
    const order: string[] = [];
    const send = vi.fn(() => {
      order.push("send");
      return true;
    });
    const markPending = vi.fn(() => {
      order.push("pending");
      return true;
    });

    expect(
      admitSectionWindowRequest({
        direction: "newer",
        requestKey: "thread:q-1:20:30",
        pendingRequestKey: null,
        send,
        markPending,
      }),
    ).toBe(true);
    expect(order).toEqual(["send", "pending"]);
  });

  it("does not duplicate an already-pending request", () => {
    const send = vi.fn(() => true);
    const markPending = vi.fn(() => true);

    expect(
      admitSectionWindowRequest({
        direction: "older",
        requestKey: "thread:q-1:0:30",
        pendingRequestKey: "thread:q-1:0:30",
        send,
        markPending,
      }),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(markPending).not.toHaveBeenCalled();
  });
});
