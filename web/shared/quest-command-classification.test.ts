import { describe, expect, it } from "vitest";
import {
  classifyQuestCommand,
  isQuestMutationCommand,
  questCommandReadsStdin,
} from "./quest-command-classification.js";

describe("Quest command classification", () => {
  it("identifies read commands, provider-controlled mutations, and reassign", () => {
    // Both the CLI proxy and server route consume this contract, so authority
    // and target extraction must not drift between process boundaries.
    expect(classifyQuestCommand(["show", "q-12"])).toEqual({ kind: "read" });
    expect(classifyQuestCommand(["claim", "Q-12"])).toEqual({ kind: "mutation", questId: "q-12" });
    expect(classifyQuestCommand(["reassign", "q-12"])).toEqual({ kind: "reassign", questId: "q-12" });
    expect(isQuestMutationCommand(["create", "Title"])).toBe(true);
  });

  it.each([
    [["claim", "--force", "--reason", "stale owner", "q-12"], "mutation"],
    [["edit", "--title", "Updated", "--json", "q-12"], "mutation"],
    [["complete", "--debrief", "Done", "--no-code", "q-12"], "mutation"],
    [["cancel", "--notes", "Superseded", "--json", "q-12"], "mutation"],
    [["address", "--json", "q-12", "0"], "mutation"],
    [["feedback", "--text", "Note", "--json", "add", "q-12"], "mutation"],
    [["feedback", "--text", "Note", "--json", "q-12"], "mutation"],
    [["feedback", "--text", "Edit", "--json", "edit", "q-12", "0"], "mutation"],
    [["quiz", "--items-file", "quiz.json", "--json", "set", "q-12"], "mutation"],
    [["reassign", "--session", "worker", "--reason", "handoff", "--json", "q-12"], "reassign"],
  ])("extracts the target after valued and boolean flags from %j", (args, kind) => {
    expect(classifyQuestCommand(args)).toMatchObject({ kind, questId: "q-12" });
  });

  it("only marks genuinely flat feedback additions as board-safe", () => {
    expect(classifyQuestCommand(["feedback", "q-12", "--text", "note"])).toMatchObject({
      kind: "mutation",
      questId: "q-12",
      flatFeedbackAdd: true,
    });
    expect(classifyQuestCommand(["feedback", "add", "q-12", "--text", "note", "--no-phase"])).toMatchObject({
      flatFeedbackAdd: true,
    });
    expect(classifyQuestCommand(["feedback", "add", "q-12", "--text", "note", "--phase", "work"])).toEqual({
      kind: "mutation",
      questId: "q-12",
    });
    expect(classifyQuestCommand(["feedback", "edit", "q-12", "0", "--text", "edit"])).toEqual({
      kind: "mutation",
      questId: "q-12",
    });
  });

  it("detects stdin only when a supported rich-text file flag consumes it", () => {
    expect(questCommandReadsStdin(["feedback", "q-12", "--text-file", "-"])).toBe(true);
    expect(questCommandReadsStdin(["feedback", "q-12", "--text", "-"])).toBe(false);
    expect(questCommandReadsStdin(["complete", "q-12", "--debrief-file", "-"])).toBe(true);
  });

  it("fails closed for unknown and future commands", () => {
    expect(classifyQuestCommand(["future-mutation", "q-12"])).toEqual({ kind: "unknown" });
    expect(classifyQuestCommand(["feedback", "future-mutation", "q-12"])).toEqual({ kind: "unknown" });
    expect(classifyQuestCommand(["quiz", "future-mutation", "q-12"])).toEqual({ kind: "unknown" });
    expect(classifyQuestCommand(["outcome", "show", "q-12"])).toEqual({ kind: "read" });
    expect(classifyQuestCommand(["outcome", "set", "q-12", "--text-file", "legacy.md"])).toEqual({ kind: "unknown" });
    expect(classifyQuestCommand(["outcome", "use", "q-12", "--session", "7"])).toEqual({ kind: "unknown" });
    expect(classifyQuestCommand(["outcome", "future-mutation", "q-12"])).toEqual({ kind: "unknown" });
    expect(isQuestMutationCommand(["future-mutation", "q-12"])).toBe(true);
  });
});
