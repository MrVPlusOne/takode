import { describe, expect, it } from "vitest";
import { readPptxSlides } from "./pptx-slides.js";
import { makePptx } from "./test-fixtures/pptx.js";

/**
 * Reading a PowerPoint file's slides for the Library: presentation order, hidden slides left out
 * (LibreOffice leaves them out of the slide pictures too), titles from the title placeholder or,
 * on slides built from text boxes, from the largest text, and speaker notes from the notes body.
 */

describe("readPptxSlides", () => {
  it("reads titles, text and notes of the shown slides in order", () => {
    const slides = readPptxSlides(
      makePptx([
        { title: "FV weekly & update", boxes: [{ text: "Nov 12" }], notes: "Open with the headline.\nThen numbers." },
        { title: "Backup slide", hidden: true },
        {
          // Built from text boxes, as many generated decks are: the largest text is the title.
          boxes: [
            { text: "SPECIAL DOMAINS · FORMAL VERIFICATION", size: 1100 },
            { text: "Proofs as exact rewards", size: 2800 },
            { text: "Task: a theorem <in Lean>\nGraded by the checker", size: 1800 },
          ],
        },
      ]),
    );
    expect(slides).toEqual([
      { title: "FV weekly & update", text: "Nov 12", notes: "Open with the headline.\nThen numbers." },
      {
        title: "Proofs as exact rewards",
        text: "SPECIAL DOMAINS · FORMAL VERIFICATION\nTask: a theorem <in Lean>\nGraded by the checker",
        notes: "",
      },
    ]);
  });

  it("refuses a file that is not a PowerPoint file", () => {
    expect(() => readPptxSlides(new TextEncoder().encode("not a zip"))).toThrow(/not a PowerPoint/);
  });
});
