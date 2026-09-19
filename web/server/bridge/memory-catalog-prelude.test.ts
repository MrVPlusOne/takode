import { describe, expect, it, vi } from "vitest";
import {
  acceptMemoryCatalogPrelude,
  attachMemoryCatalogPrelude,
  hasPendingMemoryCatalog,
  normalizeCompactionMemoryCatalog,
  requestCompactionMemoryCatalog,
} from "./memory-catalog-prelude.js";
import {
  buildAvailableMemoryCatalogBundle,
  buildUnavailableMemoryCatalogBundle,
} from "../memory-catalog-injection-utils.js";
import { buildMemoryCatalogInjectionBundle } from "../memory-catalog-injection.js";
import { deriveAttachmentPaths } from "../attachment-paths.js";

function session(): any {
  return {
    id: "catalog-session",
    backendType: "codex",
    state: { memorySessionSpaceSlug: "example-space" },
    messageHistory: [{ type: "compact_marker", id: "boundary-a", timestamp: 1, compactionStatus: "completed" }],
  };
}

const message = { type: "user_message" as const, content: "Continue the existing task" };

describe("native compaction catalog prelude", () => {
  it.each(["startup", "compaction"])("preserves processed image paths when attaching a %s catalog", async (kind) => {
    // A prelude must preserve the primary input's path-only image transport instead of swallowing its references.
    const target = session();
    if (kind === "startup") target.pendingStartupMemoryCatalogInjection = true;
    else requestCompactionMemoryCatalog(target);
    const input = { ...message, imageRefs: [{ imageId: "fixture-image", media_type: "image/png", optimized: true }] };
    const attachment = await attachMemoryCatalogPrelude(target, input, {
      buildMemoryCatalogInjectionBundle: () => buildAvailableMemoryCatalogBundle("snapshot"),
    } as any);
    expect(attachment.message.imageRefs).toEqual(input.imageRefs);
    expect(attachment.message.content).toBe(input.content);
    expect(attachment.message.deliveryContent).toContain(deriveAttachmentPaths(target.id, input.imageRefs)[0]);
    expect(attachment.message.deliveryContent).toContain("Memory catalog preloaded");
    expect(attachment.message.deliveryContent).not.toContain("data:image");
  });

  it("requests only completed boundaries, once each, including after a durable round trip", () => {
    // Replay must not rearm an accepted boundary, while a later real compaction must.
    const target = session();
    target.messageHistory[0].compactionStatus = "started";
    requestCompactionMemoryCatalog(target);
    expect(hasPendingMemoryCatalog(target)).toBe(false);
    target.messageHistory[0].compactionStatus = "completed";
    requestCompactionMemoryCatalog(target);
    expect(target.compactionMemoryCatalog).toEqual({ boundaryId: "boundary-a", pending: true });
    target.compactionMemoryCatalog.pending = false;
    target.compactionMemoryCatalog = normalizeCompactionMemoryCatalog(
      JSON.parse(JSON.stringify(target.compactionMemoryCatalog)),
    );
    requestCompactionMemoryCatalog(target);
    expect(hasPendingMemoryCatalog(target)).toBe(false);
    target.messageHistory.push({
      type: "compact_marker",
      id: "boundary-b",
      timestamp: 2,
      compactionStatus: "completed",
    });
    requestCompactionMemoryCatalog(target);
    expect(target.compactionMemoryCatalog).toEqual({ boundaryId: "boundary-b", pending: true });
  });

  it.each([
    undefined,
    null,
    {},
    { boundaryId: "a", pending: "yes" },
    { boundaryId: "", pending: true },
  ])("does not manufacture a pending request from absent or invalid persisted state %j", (value) => {
    // Old sessions have no field; malformed state must not create unsolicited catalog work.
    expect(normalizeCompactionMemoryCatalog(value)).toBeUndefined();
  });

  it.each([
    "/compact",
    "/status",
    "/full-access",
  ])("keeps catalog context off the local control command %s", async (content) => {
    // Appending text to a slash command could turn it into an accidental model prompt.
    const target = session();
    requestCompactionMemoryCatalog(target);
    const build = vi.fn();
    const attachment = await attachMemoryCatalogPrelude(target, { ...message, content }, {
      buildMemoryCatalogInjectionBundle: build,
    } as any);
    acceptMemoryCatalogPrelude(target, attachment);
    expect(build).not.toHaveBeenCalled();
    expect(attachment.message.content).toBe(content);
    expect(target.compactionMemoryCatalog.pending).toBe(true);
  });

  it("discards preparation superseded by a newer completed boundary without blocking the input", async () => {
    // A slow old scan must neither add stale orientation nor clear the newer pending request.
    const target = session();
    requestCompactionMemoryCatalog(target);
    let resolve!: (value: ReturnType<typeof buildAvailableMemoryCatalogBundle>) => void;
    const building = new Promise<ReturnType<typeof buildAvailableMemoryCatalogBundle>>((done) => {
      resolve = done;
    });
    const pending = attachMemoryCatalogPrelude(target, message, {
      buildMemoryCatalogInjectionBundle: () => building,
    } as any);
    target.messageHistory.push({
      type: "compact_marker",
      id: "boundary-b",
      timestamp: 2,
      compactionStatus: "completed",
    });
    requestCompactionMemoryCatalog(target);
    resolve(buildAvailableMemoryCatalogBundle("old snapshot"));
    const attachment = await pending;
    expect(attachment.message).toBe(message);
    acceptMemoryCatalogPrelude(target, attachment);
    expect(target.compactionMemoryCatalog).toEqual({ boundaryId: "boundary-b", pending: true });
  });

  it("does not clear a newer request when an older attachment is accepted", async () => {
    // Compaction can also race the route after assembly, before ordinary-input acceptance.
    const target = session();
    requestCompactionMemoryCatalog(target);
    const recordSeen = vi.fn(async () => {});
    const bundle = { ...buildAvailableMemoryCatalogBundle("snapshot"), recordSeen };
    const attachment = await attachMemoryCatalogPrelude(target, message, {
      buildMemoryCatalogInjectionBundle: () => bundle,
    } as any);
    expect(recordSeen).not.toHaveBeenCalled();
    target.messageHistory.push({
      type: "compact_marker",
      id: "boundary-b",
      timestamp: 2,
      compactionStatus: "completed",
    });
    requestCompactionMemoryCatalog(target);
    acceptMemoryCatalogPrelude(target, attachment);
    expect(recordSeen).toHaveBeenCalledOnce();
    expect(target.compactionMemoryCatalog).toEqual({ boundaryId: "boundary-b", pending: true });
  });

  it("reuses a catalog already owned by startup or recycle delivery without duplicate history", async () => {
    // Fresh-thread recovery has its own catalog acceptance callback and must retain it.
    const target = session();
    requestCompactionMemoryCatalog(target);
    const build = vi.fn();
    const withCatalog = {
      ...message,
      historyFollowUps: [{ content: "existing catalog", agentSource: { sessionId: "system:memory-catalog" } }],
    };
    const attachment = await attachMemoryCatalogPrelude(target, withCatalog, {
      buildMemoryCatalogInjectionBundle: build,
    } as any);
    acceptMemoryCatalogPrelude(target, attachment);
    expect(attachment.message).toBe(withCatalog);
    expect(build).not.toHaveBeenCalled();
    expect(hasPendingMemoryCatalog(target)).toBe(false);
  });

  it.each(["unavailable", "clipped"])("does not mark a %s catalog as seen", async (kind) => {
    // Accepted ordinary input can consume an optional attempt without claiming complete orientation.
    const target = session();
    requestCompactionMemoryCatalog(target);
    const recordSeen = vi.fn(async () => {});
    const bundle =
      kind === "unavailable"
        ? buildUnavailableMemoryCatalogBundle(new Error("scan failed"))
        : buildAvailableMemoryCatalogBundle("x".repeat(2000), { limit: 1000 });
    const attachment = await attachMemoryCatalogPrelude(target, message, {
      buildMemoryCatalogInjectionBundle: () => ({ ...bundle, recordSeen }),
    } as any);
    acceptMemoryCatalogPrelude(target, attachment);
    expect(recordSeen).not.toHaveBeenCalled();
    expect(hasPendingMemoryCatalog(target)).toBe(false);
  });

  it("retains the bounded fail-open timeout of the production builder", async () => {
    // An unresponsive isolated catalog scan must settle; no provider or real memory repo is used.
    vi.useFakeTimers();
    try {
      const target = session();
      requestCompactionMemoryCatalog(target);
      const attachmentPromise = attachMemoryCatalogPrelude(target, message, {
        buildMemoryCatalogInjectionBundle: () =>
          buildMemoryCatalogInjectionBundle({
            timeoutMs: 100,
            catalog: () => new Promise(() => {}),
            logger: { info: vi.fn(), warn: vi.fn() },
          }),
      } as any);
      await vi.advanceTimersByTimeAsync(100);
      const attachment = await attachmentPromise;
      expect(attachment.bundle?.unavailable).toBe(true);
      expect(attachment.message.content).toBe(message.content);
      acceptMemoryCatalogPrelude(target, attachment);
      expect(hasPendingMemoryCatalog(target)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
