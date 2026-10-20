import { beforeEach, describe, expect, it, vi } from "vitest";

const quests = vi.hoisted(() => ({ byId: new Map<string, unknown>() }));
vi.mock("./quest-store.js", () => ({ getQuest: async (id: string) => quests.byId.get(id) ?? null }));

import { describeReadAloudLinks } from "./read-aloud-links.js";

const DELIVERY = "6351a7240c7729469dbc2026452007a9";
const SHA = "2274e2100487c83b62bdc7db8275dbc7ba6e0fe9";

describe("describeReadAloudLinks", () => {
  beforeEach(() => {
    quests.byId.clear();
    quests.byId.set("q-2731", {
      codeDeliveries: [{ id: DELIVERY, commits: [{ sha: SHA, additions: 153, deletions: 9 }] }],
    });
  });

  it("gives each commit chip's recorded size, which the message text does not contain", () => {
    // The feed shows a chip's line counts from the quest's delivery record.
    const text = `Fixed.\n\n[fix(voice): record the mic directly](quest:q-2731:delivery:${DELIVERY}:commit:${SHA})`;
    return expect(describeReadAloudLinks(text)).resolves.toBe(
      '- Commit chip "fix(voice): record the mic directly": 153 lines added, 9 removed',
    );
  });

  it("says the size is unknown when the delivery is not found, and is empty without chips", async () => {
    const other = "0".repeat(40);
    await expect(describeReadAloudLinks(`[x](quest:q-1:delivery:${DELIVERY}:commit:${other})`)).resolves.toBe(
      '- Commit chip "x": size unknown',
    );
    await expect(describeReadAloudLinks("See [q-2731](quest:q-2731) and [#5](session:5).")).resolves.toBe("");
  });
});
