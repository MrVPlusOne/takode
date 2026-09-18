import { describe, expect, it } from "vitest";
import { compactPendingCodexInputsForBrowser } from "../../server/codex-pending-input-safety.js";
import type { PendingCodexInput, PendingUserUpload } from "../types.js";
import { filterPendingCodexInputsForThread, filterPendingUserUploadsForThread } from "./thread-projection.js";

function input(id: string, route: Partial<PendingCodexInput> = {}): PendingCodexInput {
  return { id, content: id, timestamp: 1, cancelable: true, ...route };
}

describe("pending destination visibility", () => {
  it("keeps known human and background destinations scoped through browser projection", () => {
    // Restored queue records can have an empty primary key alongside an intact
    // quest route. Use the actual reconnect/broadcast projection, not chat history.
    const queued = [
      input("human", { threadKey: "", questId: "q-41", clientMsgId: "composer-owner" }),
      input("herd", { threadKey: " ", questId: "q-42", agentSource: { sessionId: "herd-events" } }),
      input("main", { threadKey: "main", questId: "q-41" }),
      input("unknown", { content: "Discuss q-41 without a known destination" }),
    ];
    const before = structuredClone(queued);
    const snapshot = compactPendingCodexInputsForBrowser(queued);
    const ids = (thread: string) => filterPendingCodexInputsForThread(snapshot, thread).map((item) => item.id);

    expect(ids("q-41")).toEqual(["human", "unknown"]);
    expect(ids("q-42")).toEqual(["herd", "unknown"]);
    expect(ids("main")).toEqual(["main", "unknown"]);
    expect(ids("q-99")).toEqual(["unknown"]);
    expect(filterPendingCodexInputsForThread(snapshot, "all")).toBe(snapshot);
    expect(filterPendingCodexInputsForThread(snapshot, "q-41")[0]).toBe(snapshot[0]);
    expect(queued).toEqual(before);
  });

  it.each(["", " ", "all", "invalid-route"])("does not treat %j as a delivery destination", (threadKey) => {
    // Aggregate view keys and malformed metadata must neither hide unknown work
    // nor mask a separate valid destination field.
    const snapshot = compactPendingCodexInputsForBrowser([
      input("known", { threadKey, questId: " Q-41 " }),
      input("unknown", { threadKey }),
    ]);
    expect(filterPendingCodexInputsForThread(snapshot, "q-41").map((item) => item.id)).toEqual(["known", "unknown"]);
    expect(filterPendingCodexInputsForThread(snapshot, "main").map((item) => item.id)).toEqual(["unknown"]);
  });

  it("uses direct destinations before references and preserves known reference-only routes", () => {
    // Association metadata must not override an explicit pending destination.
    const snapshot = compactPendingCodexInputsForBrowser([
      input("direct", { threadKey: "q-41", threadRefs: [{ threadKey: "q-42", source: "explicit" }] }),
      input("reference", { threadRefs: [{ threadKey: "", questId: "q-42", source: "explicit" }] }),
    ]);
    expect(filterPendingCodexInputsForThread(snapshot, "q-41").map((item) => item.id)).toEqual(["direct"]);
    expect(filterPendingCodexInputsForThread(snapshot, "q-42").map((item) => item.id)).toEqual(["reference"]);
    expect(filterPendingCodexInputsForThread(snapshot, "main")).toEqual([]);
  });

  it("preserves local upload ownership and keeps unknown preparation visible", () => {
    // Before server admission the browser owns attachment preparation; filtering
    // must retain the same object/ID for its existing actions and replacement.
    const uploads: PendingUserUpload[] = [
      { id: "known", content: "known", timestamp: 1, stage: "delivering", images: [], threadKey: "", questId: "q-41" },
      { id: "unknown", content: "unknown", timestamp: 2, stage: "delivering", images: [] },
    ];
    expect(filterPendingUserUploadsForThread(uploads, "q-41")).toEqual(uploads);
    expect(filterPendingUserUploadsForThread(uploads, "q-42")).toEqual([uploads[1]]);
    expect(filterPendingUserUploadsForThread(uploads, "main")).toEqual([uploads[1]]);
    expect(filterPendingUserUploadsForThread(uploads, "all")).toBe(uploads);
  });
});
