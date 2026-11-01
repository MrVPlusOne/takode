// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { isLeaderThreadRunning, selectLeaderPhaseDotsKey } from "./leader-thread-tabs-resolver.js";

const LEADER = "leader";

beforeEach(() => {
  useStore.getState().reset();
  useStore.setState({
    sessionBoards: new Map([[LEADER, [{ questId: "q-1", title: "Quest 1", status: "WORKING", updatedAt: 1 }]]]),
  } as never);
});

describe("selectLeaderPhaseDotsKey", () => {
  it("takes the Overview button's phase dots from the board until a projection carries them", () => {
    expect(selectLeaderPhaseDotsKey(useStore.getState(), LEADER)).toBe("q-1:work");
  });

  it("takes them from the projection once it does, whatever the board detail says", () => {
    // The board detail and the projection arrive in separate messages: following the projection
    // alone, a quest changing phase redraws the leader's navigation once, with its tabs.
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: LEADER,
        value: createLeaderThreadTabsProjectionValue({ activePhaseDots: ["q-1:memory", "q-2:work"] }),
      }),
    );
    expect(selectLeaderPhaseDotsKey(useStore.getState(), LEADER)).toBe("q-1:memory,q-2:work");
  });
});

describe("isLeaderThreadRunning", () => {
  it("follows the status groups' running rule: a running quest, or the thread the leader writes in", () => {
    // The side column's dot uses this, so a thread working in the main view never reads as idle
    // in its side copy.
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: LEADER,
        value: { ...createLeaderThreadTabsProjectionValue(), runningQuestIds: ["q-5"] },
      }),
    );
    const running = (threadKey: string) => isLeaderThreadRunning(useStore.getState(), LEADER, threadKey);
    expect(running("Q-5")).toBe(true);
    expect(running("q-6")).toBe(false);
    expect(running("topic:aa11bb22")).toBe(false);
    // The leader writing in a thread counts while its turn runs, and only then.
    useStore.setState({
      activeTurnRoutes: new Map([[LEADER, { threadKey: "topic:aa11bb22" }]]),
      sessionStatus: new Map([[LEADER, "running"]]),
    } as never);
    expect(running("topic:aa11bb22")).toBe(true);
    useStore.setState({ sessionStatus: new Map([[LEADER, "idle"]]) } as never);
    expect(running("topic:aa11bb22")).toBe(false);
  });
});
