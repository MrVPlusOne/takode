import { afterEach, describe, expect, it, vi } from "vitest";
import { InputTraceUpload } from "./input-trace-upload.js";
import type { InputTraceBatch } from "../../shared/input-trace.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const events = [{ seq: 1, t: 1, type: "paste" }];
  const status = vi.fn();
  const upload = new InputTraceUpload(
    (after) => ({
      traceId: "page",
      recordingSince: 1,
      platform: "Mac",
      userAgent: "test",
      events: events.filter((e) => e.seq > after),
    }),
    status,
  );
  return { events, status, upload };
}

describe("input trace automatic upload", () => {
  it("sends only unsaved events and retries the same sequence after a failure", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { upload, events, status } = fixture();
    upload.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ error: "offline" }));
    await vi.advanceTimersByTimeAsync(1000);
    events.push({ seq: 2, t: 2, type: "input" });
    upload.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    const sent = fetch.mock.calls.map((call) => JSON.parse(call[1].body) as InputTraceBatch);
    expect(sent.map((batch) => batch.events.map((e) => e.seq))).toEqual([[1], [1], [2]]);
    upload.stop();
  });

  it("flushes on pagehide during a pending request and stops scheduling when disabled", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { upload } = fixture();
    upload.flush();
    upload.flush(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].keepalive).toBe(true);
    upload.schedule();
    upload.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
