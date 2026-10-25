import { describe, expect, it } from "vitest";
import { ComposerUndoHistory } from "./composer-undo-history.js";

// The history watches the draft text itself, so every source of change (typing, paste,
// voice transcripts, synced drafts) is undoable. These tests pin how changes become steps.
describe("ComposerUndoHistory", () => {
  it("undoes a large paste back to the text before it, and redoes it", () => {
    const history = new ComposerUndoHistory("Draft");
    history.record("Draft\n<big pasted log>", 20, 1_000);

    expect(history.undo()).toEqual({ text: "Draft", cursor: 5 });
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toEqual({ text: "Draft\n<big pasted log>", cursor: 20 });
    expect(history.canRedo).toBe(false);
  });

  it("joins single-character typing within a short pause into one step", () => {
    const history = new ComposerUndoHistory("");
    history.record("h", 1, 1_000);
    history.record("hi", 2, 1_300);
    history.record("hi!", 3, 1_600);

    expect(history.undo()?.text).toBe("");
    expect(history.canUndo).toBe(false);
  });

  it("starts a new step after a pause in typing", () => {
    const history = new ComposerUndoHistory("");
    history.record("h", 1, 1_000);
    history.record("hi", 2, 5_000);

    expect(history.undo()?.text).toBe("h");
    expect(history.undo()?.text).toBe("");
  });

  it("keeps a paste as its own step even right after typing", () => {
    const history = new ComposerUndoHistory("");
    history.record("a", 1, 1_000);
    history.record("a pasted text", 13, 1_100);

    expect(history.undo()?.text).toBe("a");
  });

  it("drops redo steps when the draft changes after an undo", () => {
    const history = new ComposerUndoHistory("one");
    history.record("one two", 7, 1_000);
    history.undo();
    history.record("one three", 9, 5_000);

    expect(history.canRedo).toBe(false);
    expect(history.undo()?.text).toBe("one");
  });

  it("ignores reports of the text it already holds, such as a restored undo arriving back", () => {
    const history = new ComposerUndoHistory("a");
    history.record("a b", 3, 1_000);
    const restored = history.undo();

    expect(history.record(restored!.text, 1, 1_100)).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("forgets everything on reset, as after sending", () => {
    const history = new ComposerUndoHistory("");
    history.record("sent text", 9, 1_000);
    history.reset("");

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("keeps at most 100 steps", () => {
    const history = new ComposerUndoHistory("");
    for (let i = 1; i <= 120; i++) history.record("x".repeat(i * 2), i * 2, i * 10_000);

    let steps = 0;
    while (history.undo()) steps++;
    expect(steps).toBe(100);
  });
});
