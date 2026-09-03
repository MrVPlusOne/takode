import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_VIEWPORT_HANDOFFS_PER_SESSION,
  type ViewportHandoffPosition,
  type ViewportHandoffWriteRequest,
} from "../shared/viewport-handoff.js";
import { ViewportHandoffStore, replaceViewportHandoffFileAtomically } from "./viewport-handoff-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeStore(
  writer?: ConstructorParameters<typeof ViewportHandoffStore>[1],
): Promise<{ root: string; store: ViewportHandoffStore }> {
  const root = await mkdtemp(join(tmpdir(), "takode-viewport-handoff-"));
  roots.push(root);
  return { root, store: new ViewportHandoffStore(root, writer) };
}

function position(value: number): ViewportHandoffPosition {
  return {
    scrollTop: value,
    scrollHeight: value + 1_000,
    isAtBottom: false,
    anchorMessageId: `message-${value}`,
    anchorTurnId: `turn-${value}`,
    anchorOffsetTop: -12.5,
    lastSeenContentBottom: value + 900,
  };
}

function writeRequest(overrides: Partial<ViewportHandoffWriteRequest> = {}): ViewportHandoffWriteRequest {
  return {
    baseRevision: null,
    baseSelectedThreadRevision: 0,
    lastDeliberateActivityAt: null,
    lastSelectionActivityAt: null,
    sourceId: "browser-a",
    departureId: "departure-a",
    threadKey: "main",
    selectedThreadKey: "main",
    position: position(100),
    ...overrides,
  };
}

function persistedFixture() {
  return {
    version: 1,
    sessionId: "session-1",
    revision: 1,
    updatedAt: 100,
    selectedThreadKey: "main",
    selectedThreadRevision: 1,
    selectedThreadActivityAt: 100,
    selectedThreadUpdatedAt: 100,
    handoffs: {
      main: {
        version: 1,
        threadKey: "main",
        revision: 1,
        sourceId: "browser-a",
        departureId: "departure-a",
        activityAt: 100,
        updatedAt: 100,
        position: position(100),
      },
    },
    recentDepartures: [{ sourceId: "browser-a", departureId: "departure-a", revision: 1 }],
  };
}

function corruptPersistedContents(mutator: (state: ReturnType<typeof persistedFixture>) => void): string {
  const state = persistedFixture();
  mutator(state);
  return `  ${JSON.stringify(state, null, 2)}\n`;
}

describe("ViewportHandoffStore", () => {
  it("persists one versioned session/thread handoff across store instances", async () => {
    const { root, store } = await makeStore();

    const published = await store.publish(
      "session-1",
      writeRequest({ threadKey: "Q-41", selectedThreadKey: "Q-41" }),
      1_000,
    );

    expect(published).toMatchObject({
      status: "accepted",
      serverNow: 1_000,
      state: {
        version: 1,
        sessionId: "session-1",
        revision: 1,
        selectedThreadKey: "q-41",
      },
      record: {
        version: 1,
        threadKey: "q-41",
        revision: 1,
        sourceId: "browser-a",
        departureId: "departure-a",
        activityAt: 0,
        updatedAt: 1_000,
        position: { anchorMessageId: "message-100", anchorOffsetTop: -12.5 },
      },
    });

    const restored = new ViewportHandoffStore(root);
    expect(await restored.readThread("session-1", "q-41")).toMatchObject({
      state: { revision: 1, selectedThreadKey: "q-41" },
      record: { revision: 1, updatedAt: 1_000 },
    });
  });

  it("skips stale idle writers but accepts a stale writer with newer deliberate activity", async () => {
    const { store } = await makeStore();
    const first = await store.publish("session-1", writeRequest(), 100);
    expect(first.status).toBe("accepted");

    const second = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: 1,
        sourceId: "browser-b",
        departureId: "departure-b",
        lastDeliberateActivityAt: 200,
        position: position(200),
      }),
      200,
    );
    expect(second.status).toBe("accepted");

    const stale = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: 1,
        lastDeliberateActivityAt: 200,
        departureId: "departure-a-stale",
        position: position(300),
      }),
      300,
    );
    expect(stale).toMatchObject({
      status: "stale",
      state: { revision: 2 },
      record: { sourceId: "browser-b" },
    });

    const newer = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: 1,
        lastDeliberateActivityAt: 201,
        departureId: "departure-a-newer",
        position: position(400),
      }),
      400,
    );
    expect(newer).toMatchObject({
      status: "accepted",
      state: { revision: 3 },
      record: {
        revision: 3,
        sourceId: "browser-a",
        position: { scrollTop: 400 },
      },
    });
  });

  it("lets later real activity supersede an idle cold-baseline write that committed later", async () => {
    const { store } = await makeStore();

    const idle = await store.publish("session-1", writeRequest(), 1_000);
    expect(idle).toMatchObject({
      status: "accepted",
      state: { selectedThreadActivityAt: 0 },
      record: { activityAt: 0, updatedAt: 1_000 },
    });

    const moved = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: null,
        baseSelectedThreadRevision: 0,
        lastDeliberateActivityAt: 150,
        lastSelectionActivityAt: 150,
        sourceId: "browser-b",
        departureId: "moved-after-idle",
        position: position(150),
      }),
      1_001,
    );

    expect(moved).toMatchObject({
      status: "accepted",
      state: { revision: 2, selectedThreadActivityAt: 150 },
      record: { sourceId: "browser-b", activityAt: 150, updatedAt: 1_001 },
    });
  });

  it("orders stale-base position intent by accepted activity rather than commit time", async () => {
    const { store } = await makeStore();

    const first = await store.publish(
      "session-1",
      writeRequest({
        lastDeliberateActivityAt: 150,
        sourceId: "browser-a",
        departureId: "move-a",
        position: position(150),
      }),
      1_000,
    );
    expect(first.record).toMatchObject({ activityAt: 150, updatedAt: 1_000 });

    const laterActivity = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: null,
        lastDeliberateActivityAt: 151,
        sourceId: "browser-b",
        departureId: "move-b",
        position: position(151),
      }),
      1_001,
    );

    expect(laterActivity).toMatchObject({
      status: "accepted",
      state: { revision: 2 },
      record: {
        sourceId: "browser-b",
        activityAt: 151,
        updatedAt: 1_001,
        position: { scrollTop: 151 },
      },
    });
  });

  it("arbitrates per-thread positions and selected-thread handoffs independently", async () => {
    const { store } = await makeStore();

    const main = await store.publish("session-1", writeRequest(), 100);
    const quest = await store.publish(
      "session-1",
      writeRequest({
        baseSelectedThreadRevision: main.state.selectedThreadRevision,
        sourceId: "browser-b",
        departureId: "departure-b",
        threadKey: "q-2",
        selectedThreadKey: "q-2",
        position: position(200),
      }),
      200,
    );
    expect(quest).toMatchObject({
      status: "accepted",
      state: {
        revision: 2,
        selectedThreadKey: "q-2",
        selectedThreadRevision: 2,
        selectedThreadUpdatedAt: 200,
      },
    });

    const idleStaleSelection = await store.publish(
      "session-1",
      writeRequest({
        baseSelectedThreadRevision: main.state.selectedThreadRevision,
        sourceId: "browser-a",
        departureId: "departure-a-q3",
        threadKey: "q-3",
        selectedThreadKey: "q-3",
        position: position(300),
      }),
      300,
    );
    expect(idleStaleSelection).toMatchObject({
      status: "accepted",
      state: {
        revision: 3,
        selectedThreadKey: "q-2",
        selectedThreadRevision: 2,
        selectedThreadUpdatedAt: 200,
      },
      record: {
        threadKey: "q-3",
        revision: 3,
        position: { scrollTop: 300 },
      },
    });

    const newerSelection = await store.publish(
      "session-1",
      writeRequest({
        baseSelectedThreadRevision: main.state.selectedThreadRevision,
        lastSelectionActivityAt: 201,
        sourceId: "browser-a",
        departureId: "departure-a-q4",
        threadKey: "q-4",
        selectedThreadKey: "q-4",
        position: position(400),
      }),
      400,
    );
    expect(newerSelection).toMatchObject({
      status: "accepted",
      state: {
        revision: 4,
        selectedThreadKey: "q-4",
        selectedThreadRevision: 4,
        selectedThreadUpdatedAt: 400,
      },
      record: { threadKey: "q-4", revision: 4 },
    });
  });

  it("orders concurrent selected-thread intent by accepted activity rather than commit time", async () => {
    const { store } = await makeStore();
    const initial = await store.publish("session-1", writeRequest(), 100);

    const quest = await store.publish(
      "session-1",
      writeRequest({
        baseSelectedThreadRevision: initial.state.selectedThreadRevision,
        lastSelectionActivityAt: 150,
        sourceId: "browser-a",
        departureId: "select-quest",
        threadKey: "q-2",
        selectedThreadKey: "q-2",
        position: position(200),
      }),
      1_000,
    );
    expect(quest.state).toMatchObject({
      selectedThreadKey: "q-2",
      selectedThreadActivityAt: 150,
      selectedThreadUpdatedAt: 1_000,
    });

    const main = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: initial.record!.revision,
        baseSelectedThreadRevision: initial.state.selectedThreadRevision,
        lastSelectionActivityAt: 151,
        sourceId: "browser-a",
        departureId: "select-main",
        selectedThreadKey: "main",
        position: position(300),
      }),
      1_001,
    );

    expect(main.state).toMatchObject({
      selectedThreadKey: "main",
      selectedThreadRevision: 3,
      selectedThreadActivityAt: 151,
      selectedThreadUpdatedAt: 1_001,
    });
  });

  it("never regresses accepted position or selection activity on a base-matching write", async () => {
    const { store } = await makeStore();
    const first = await store.publish(
      "session-1",
      writeRequest({
        lastDeliberateActivityAt: 200,
        lastSelectionActivityAt: 200,
        departureId: "activity-200",
      }),
      1_000,
    );

    const baseMatch = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: first.record!.revision,
        baseSelectedThreadRevision: first.state.selectedThreadRevision,
        lastDeliberateActivityAt: 150,
        lastSelectionActivityAt: 150,
        departureId: "activity-150",
        position: position(150),
      }),
      1_001,
    );
    expect(baseMatch).toMatchObject({
      status: "accepted",
      state: { selectedThreadActivityAt: 200 },
      record: { activityAt: 200, position: { scrollTop: 150 } },
    });

    const stale = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: first.record!.revision,
        baseSelectedThreadRevision: first.state.selectedThreadRevision,
        lastDeliberateActivityAt: 199,
        lastSelectionActivityAt: 199,
        departureId: "activity-199",
        position: position(199),
      }),
      1_002,
    );
    expect(stale).toMatchObject({
      status: "stale",
      state: { revision: 2, selectedThreadActivityAt: 200 },
      record: { activityAt: 200, position: { scrollTop: 150 } },
    });
  });

  it("keeps logical server time monotonic when the wall clock rolls backward", async () => {
    const { root, store } = await makeStore();
    const first = await store.publish("session-1", writeRequest(), 5_000);

    const second = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: first.record!.revision,
        departureId: "departure-after-clock-rollback",
        position: position(200),
      }),
      1_000,
    );

    expect(second).toMatchObject({
      status: "accepted",
      serverNow: 5_001,
      state: {
        revision: 2,
        updatedAt: 5_001,
        selectedThreadRevision: 1,
        selectedThreadUpdatedAt: 5_000,
      },
      record: { revision: 2, updatedAt: 5_001 },
    });
    expect(await new ViewportHandoffStore(root).readSession("session-1")).toMatchObject({
      revision: 2,
      updatedAt: 5_001,
      handoffs: { main: { updatedAt: 5_001 } },
    });
  });

  it("does not let pre-record activity win after the wall clock rolls backward", async () => {
    const { store } = await makeStore();
    const first = await store.publish("session-1", writeRequest(), 5_000);
    const newer = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: first.record!.revision,
        baseSelectedThreadRevision: first.state.selectedThreadRevision,
        sourceId: "browser-b",
        departureId: "departure-newer",
        lastDeliberateActivityAt: 6_000,
        lastSelectionActivityAt: 6_000,
        position: position(200),
      }),
      6_000,
    );

    const stale = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: first.record!.revision,
        baseSelectedThreadRevision: first.state.selectedThreadRevision,
        lastDeliberateActivityAt: 5_500,
        lastSelectionActivityAt: 5_500,
        departureId: "departure-stale-after-rollback",
        position: position(300),
      }),
      1_000,
    );

    expect(stale).toMatchObject({
      status: "stale",
      serverNow: newer.state.updatedAt,
      state: { revision: newer.state.revision, updatedAt: newer.state.updatedAt },
      record: { sourceId: "browser-b", position: { scrollTop: 200 } },
    });
  });

  it("rejects activity timestamps materially ahead of the server clock", async () => {
    const { store } = await makeStore();

    await expect(
      store.publish("session-1", writeRequest({ lastDeliberateActivityAt: 31_001 }), 1_000),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await store.readSession("session-1")).toMatchObject({
      revision: 0,
      handoffs: {},
    });
  });

  it("deduplicates a departure even after another browser publishes a newer record", async () => {
    const { store } = await makeStore();
    await store.publish("session-1", writeRequest(), 100);
    await store.publish(
      "session-1",
      writeRequest({
        baseRevision: 1,
        sourceId: "browser-b",
        departureId: "departure-b",
        position: position(200),
      }),
      200,
    );

    const duplicate = await store.publish(
      "session-1",
      writeRequest({
        baseRevision: 1,
        lastDeliberateActivityAt: 1_000,
        position: position(999),
      }),
      300,
    );

    expect(duplicate).toMatchObject({
      status: "duplicate",
      state: { revision: 2 },
      record: { sourceId: "browser-b", position: { scrollTop: 200 } },
    });
  });

  it("serializes concurrent thread writes under one monotonic session revision", async () => {
    const { store } = await makeStore();

    const [main, quest] = await Promise.all([
      store.publish("session-1", writeRequest(), 100),
      store.publish(
        "session-1",
        writeRequest({
          baseSelectedThreadRevision: 1,
          lastSelectionActivityAt: 200,
          sourceId: "browser-b",
          departureId: "departure-b",
          threadKey: "q-2",
          selectedThreadKey: "q-2",
          position: position(200),
        }),
        200,
      ),
    ]);

    expect(main.record?.revision).toBe(1);
    expect(quest.record?.revision).toBe(2);
    expect(await store.readSession("session-1")).toMatchObject({
      revision: 2,
      selectedThreadKey: "q-2",
      handoffs: { main: { revision: 1 }, "q-2": { revision: 2 } },
    });
  });

  it("keeps only the newest bounded thread records", async () => {
    const { store } = await makeStore();

    for (let index = 1; index <= MAX_VIEWPORT_HANDOFFS_PER_SESSION + 1; index += 1) {
      await store.publish(
        "session-1",
        writeRequest({
          sourceId: `browser-${index}`,
          departureId: `departure-${index}`,
          threadKey: `q-${index}`,
          selectedThreadKey: `q-${index}`,
          position: position(index),
        }),
        index,
      );
    }

    const state = await store.readSession("session-1");
    expect(Object.keys(state.handoffs)).toHaveLength(MAX_VIEWPORT_HANDOFFS_PER_SESSION);
    expect(state.handoffs).not.toHaveProperty("q-1");
    expect(state.handoffs).toHaveProperty(`q-${MAX_VIEWPORT_HANDOFFS_PER_SESSION + 1}`);
    expect(state.revision).toBe(MAX_VIEWPORT_HANDOFFS_PER_SESSION + 1);
  });

  it.each([
    ["corrupt JSON", "{not-json"],
    ["unknown schema", JSON.stringify({ version: 99, sessionId: "session-1" })],
    [
      "an invalid accepted position activity",
      corruptPersistedContents((state) => {
        (state.handoffs.main as unknown as Record<string, unknown>).activityAt = "100";
      }),
    ],
    [
      "an invalid optional anchor offset",
      corruptPersistedContents((state) => {
        (state.handoffs.main.position as unknown as Record<string, unknown>).anchorOffsetTop = "24";
      }),
    ],
    [
      "an invalid optional last-seen boundary",
      corruptPersistedContents((state) => {
        (state.handoffs.main.position as unknown as Record<string, unknown>).lastSeenContentBottom = false;
      }),
    ],
    [
      "a non-boolean bottom flag",
      corruptPersistedContents((state) => {
        (state.handoffs.main.position as unknown as Record<string, unknown>).isAtBottom = 0;
      }),
    ],
    [
      "case-colliding handoff keys",
      corruptPersistedContents((state) => {
        (state.handoffs as Record<string, typeof state.handoffs.main>).Main = structuredClone(state.handoffs.main);
      }),
    ],
  ])("fails closed for %s without overwriting the durable file", async (_label, contents) => {
    const { store } = await makeStore();
    const path = store.filePathForTest("session-1");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(store.readSession("session-1")).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(store.publish("session-1", writeRequest(), 100)).rejects.toMatchObject({ code: "invalid_state" });
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  it("publishes nothing when an atomic replacement fails", async () => {
    let writes = 0;
    const { root, store } = await makeStore(async (path, contents) => {
      writes += 1;
      if (writes === 2) throw new Error("controlled write failure");
      await replaceViewportHandoffFileAtomically(path, contents);
    });
    await store.publish("session-1", writeRequest(), 100);

    await expect(
      store.publish(
        "session-1",
        writeRequest({
          baseRevision: 1,
          departureId: "departure-2",
          position: position(200),
        }),
        200,
      ),
    ).rejects.toMatchObject({ code: "write_failed" });

    expect(await store.readSession("session-1")).toMatchObject({
      revision: 1,
      handoffs: { main: { revision: 1 } },
    });
    const restored = new ViewportHandoffStore(root);
    expect(await restored.readSession("session-1")).toMatchObject({
      revision: 1,
      handoffs: { main: { revision: 1 } },
    });
  });

  it("removes only the selected session sidecar", async () => {
    const { store } = await makeStore();
    await store.publish("session-1", writeRequest(), 100);
    await store.publish("session-2", writeRequest(), 200);
    const firstPath = store.filePathForTest("session-1");
    const secondPath = store.filePathForTest("session-2");

    await store.deleteSession("session-1");

    await expect(access(firstPath)).rejects.toMatchObject({ code: "ENOENT" });
    await access(secondPath);
    expect(await store.readSession("session-1")).toMatchObject({
      revision: 0,
      handoffs: {},
    });
    expect(await store.readSession("session-2")).toMatchObject({ revision: 1 });
  });
});
