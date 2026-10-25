import { describe, expect, it } from "vitest";
import { nowGroupLabel, nowGroupOf, questLinksOf, takeLegacyNow } from "./topic-now-items.js";

/**
 * Now is kept as entries in fixed groups. Pages written before that carry a "## Now" section of
 * labelled bullets; takeLegacyNow turns those into entries once and takes the section off the page.
 */
describe("takeLegacyNow", () => {
  const page = [
    "T7 is the 12B coding run.",
    "",
    "## Status",
    "As of Oct 24.",
    "",
    "## Now",
    "- **Next:** compare with the twin at step 200 ([q-1](quest:q-1),",
    "  [message](session:7:12)).",
    "- **Waiting on you:** pick a name.",
    "- **Waiting on Parsewave:** the rebuilt images.",
    "- **Not tried on your iPhone:** the panel.",
    "- **Cleanup candidate:** an unused command.",
    "- no label here",
    "",
    "## History",
    "- **Oct 23** · Step 165.",
  ].join("\n");

  it("turns the bullets into grouped entries, keeping unknown labels' words, and leaves the rest", () => {
    const legacy = takeLegacyNow(page)!;
    expect(legacy.page).toBe(
      "T7 is the 12B coding run.\n\n## Status\nAs of Oct 24.\n\n## History\n- **Oct 23** · Step 165.",
    );
    expect(legacy.items).toEqual([
      { group: "next", text: "compare with the twin at step 200 ([q-1](quest:q-1), [message](session:7:12))." },
      { group: "you", text: "pick a name." },
      { group: "waiting", who: "Parsewave", text: "the rebuilt images." },
      { group: "try", text: "the panel." },
      { group: "next", text: "Cleanup candidate: an unused command." },
      { group: "next", text: "no label here" },
    ]);
  });

  it("is null for a page without a Now section", () => {
    expect(takeLegacyNow("T7.\n\n## History\n- Oct 23")).toBeNull();
    expect(takeLegacyNow(null)).toBeNull();
  });
});

describe("Now groups", () => {
  it("reads group names and labels, and names a waiting entry after whom it waits on", () => {
    expect(nowGroupOf("next")).toEqual({ group: "next" });
    expect(nowGroupOf("Waiting on you:")).toEqual({ group: "you" });
    expect(nowGroupOf("waiting")).toEqual({ group: "waiting" });
    expect(nowGroupOf("To try")).toEqual({ group: "try" });
    expect(nowGroupOf("maybe")).toBeNull();
    expect(nowGroupLabel({ group: "waiting", who: "Nic" })).toBe("Waiting on Nic");
    expect(nowGroupLabel({ group: "progress" })).toBe("In progress");
  });

  it("finds the quests an entry links to", () => {
    expect(questLinksOf("see [q-1](quest:q-1) and [q-2 feedback](quest:q-2:feedback:3)")).toEqual(["q-1", "q-2"]);
  });
});
