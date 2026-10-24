import { describe, expect, it } from "vitest";
import { nowSectionOf } from "./topic-now-items.js";

/**
 * Now items are the top-level bullets under a page's "## Now" heading. Their key stays the same
 * when a Scribe rewords an item but keeps its label and links, so the page can show when it first
 * appeared.
 */
describe("nowSectionOf", () => {
  const page = [
    "T7 is the 12B coding run.",
    "",
    "## Now",
    "- **Next:** compare with the twin at step 200 ([q-1](quest:q-1),",
    "  [message](session:7:12)).",
    "- **Next:** ship the guide ([q-2](quest:q-2:feedback:3)).",
    "- **Waiting on you:** pick a name.",
    "",
    "## Recent",
    "- **Oct 23** · Step 165.",
  ].join("\n");

  it("splits the page around the Now items, joining wrapped lines", () => {
    const section = nowSectionOf(page)!;
    expect(section.before).toBe("T7 is the 12B coding run.\n\n## Now");
    expect(section.after).toBe("## Recent\n- **Oct 23** · Step 165.");
    expect(section.items.map((item) => item.text)).toEqual([
      "**Next:** compare with the twin at step 200 ([q-1](quest:q-1), [message](session:7:12)).",
      "**Next:** ship the guide ([q-2](quest:q-2:feedback:3)).",
      "**Waiting on you:** pick a name.",
    ]);
    expect(section.items.map((item) => item.questIds)).toEqual([["q-1"], ["q-2"], []]);
  });

  it("keys items by label and links, or by words when they have no links", () => {
    const reworded = page.replace("compare with the twin at step 200", "compare with the 256K twin");
    const keys = (text: string) => nowSectionOf(text)!.items.map((item) => item.key);
    expect(keys(reworded)).toEqual(keys(page));
    expect(keys(page)[2]).toBe("waiting on you|pick a name");
    // Two items with the same label and links still get distinct keys.
    const twice = page.replace(
      "ship the guide ([q-2](quest:q-2:feedback:3))",
      "again ([q-1](quest:q-1), [message](session:7:12))",
    );
    expect(new Set(keys(twice)).size).toBe(3);
  });

  it("has no section without a Now heading or bullets", () => {
    expect(nowSectionOf("## Recent\n- x")).toBeNull();
    expect(nowSectionOf("## Now\nNothing open.\n\n## Recent")).toBeNull();
    expect(nowSectionOf(null)).toBeNull();
  });
});
