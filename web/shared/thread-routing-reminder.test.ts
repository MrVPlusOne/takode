import { describe, expect, it } from "vitest";
import { buildThreadRoutingReminderContent, isLeaderAnswerRouteDiagnostic } from "./thread-routing-reminder.js";

describe("buildThreadRoutingReminderContent", () => {
  // Leaders recovering from compaction need to know whether visible text or a shell command missed routing.
  it("identifies missing markers on visible leader text", () => {
    const content = buildThreadRoutingReminderContent({ reason: "missing", source: "visible_text" });

    expect(content).toContain("Missing thread marker on visible leader text");
    expect(content).toContain("previous visible leader message");
    expect(content).toContain("`[thread:main:C]` / `[thread:q-N:C]`");
    expect(content).toContain("`[thread:main:A:u1]` / `[thread:q-N:A:u1,u2]`");
    expect(content).toContain("standalone `---` line immediately before the next role-bearing marker");
    expect(content).toContain("`# thread:main` or `# thread:q-N`");
    expect(content).not.toContain("previous leader response");
  });

  // Shell-command reminders should not imply that the user-visible assistant text was the mistake.
  it("identifies missing markers on leader shell commands", () => {
    const content = buildThreadRoutingReminderContent({ reason: "missing", source: "shell_command" });

    expect(content).toContain("Missing thread marker on leader shell command");
    expect(content).toContain("previous leader shell command");
    expect(content).toContain("`# thread:main` or `# thread:q-N`");
    expect(content).toContain("`[thread:main:C]` / `[thread:q-N:C]`");
    expect(content).toContain("`[thread:main:A:u1]` / `[thread:q-N:A:u1,u2]`");
    expect(content).toContain("standalone `---` line immediately before each later role-bearing marker");
    expect(content).not.toContain("previous leader response");
  });

  // Older persisted routing errors may lack source metadata; keep the copy honest about uncertainty.
  it("uses uncertainty wording when the routing source is unavailable", () => {
    const content = buildThreadRoutingReminderContent({ reason: "missing" });

    expect(content).toContain("output type is unavailable");
    expect(content).toContain("If it was visible leader text");
    expect(content).toContain("standalone `---` line immediately before each later role-bearing marker");
    expect(content).toContain("If it was a leader shell command");
    expect(content).not.toContain("previous leader response");
  });

  it("keeps invalid marker details with visible text attribution", () => {
    const content = buildThreadRoutingReminderContent({
      reason: "invalid",
      source: "visible_text",
      marker: "[thread:side]",
    });

    expect(content).toContain("Invalid marker: [thread:side] on visible leader text");
  });

  it("gives one exact owner-thread correction without asking for the long answer again", () => {
    const content = buildThreadRoutingReminderContent({
      reason: "invalid_answer_route",
      source: "answer_marker",
      answerRouteDiagnostic: {
        reason: "missing_association",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u37", "u38"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u37", "u38"] }],
        missingAssociationUserMessageIds: ["u38"],
      },
    });

    expect(content).toContain("Invalid answer route from q-2044");
    expect(content).toContain("q-2044 is not visibility-associated with every referenced prompt; missing: u38");
    expect(content).toContain("Authoritative owner: q-2042 (u37,u38)");
    expect(content).toContain("[thread:q-2042:A:u37,u38]");
    expect(content).toContain("Do not regenerate the long explanation");
    expect(content).toContain("Do not mark q-2044 Ready");
  });

  it("gives one exact quest-owner correction for a disallowed Main visibility route", () => {
    const content = buildThreadRoutingReminderContent({
      reason: "invalid_answer_route",
      source: "answer_marker",
      answerRouteDiagnostic: {
        reason: "disallowed_main_backfill",
        selectedThreadKey: "main",
        answerUserMessageIds: ["u37", "u38"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u37", "u38"] }],
      },
    });

    expect(content).toContain("Main cannot be used as a visibility-only destination");
    expect(content).toContain("Authoritative owner: q-2042 (u37,u38)");
    expect(content).toContain("[thread:q-2042:A:u37,u38]");
  });

  it("explains otherwise parsed but ineligible answer rows", () => {
    const content = buildThreadRoutingReminderContent({
      reason: "invalid_answer_route",
      source: "answer_marker",
      answerRouteDiagnostic: {
        reason: "invalid_answer",
        selectedThreadKey: "main",
        answerUserMessageIds: ["u7"],
        ownerGroups: [],
      },
    });

    expect(content).toContain("answer metadata or message shape is invalid: u7");
    expect(content).toContain("No single corrected answer marker is safe");
    expect(content).toContain("did not gain coverage");
  });

  it.each([
    "unproven_owner",
    "nonconsecutive_ids",
    "stale",
    "route_control_conflict",
  ] as const)("does not suggest an exact correction for %s evidence", (reason) => {
    const content = buildThreadRoutingReminderContent({
      reason: "invalid_answer_route",
      source: "answer_marker",
      answerRouteDiagnostic: {
        reason,
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u37", "u38"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u37", "u38"] }],
      },
    });

    expect(content).toContain("No single corrected answer marker is safe from this evidence");
    expect(content).not.toContain("Authoritative owner:");
    expect(content).not.toContain("[thread:q-2042:A:u37,u38]");
  });

  it("fails closed without suggesting one marker for a mixed-owner answer", () => {
    const content = buildThreadRoutingReminderContent({
      reason: "invalid_answer_route",
      source: "answer_marker",
      answerRouteDiagnostic: {
        reason: "multiple_owners",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u37", "u38"],
        ownerGroups: [
          { threadKey: "q-2042", userMessageIds: ["u37"] },
          { threadKey: "main", userMessageIds: ["u38"] },
        ],
      },
    });

    expect(content).toContain("q-2042 (u37); Main (u38)");
    expect(content).toContain("No single corrected answer marker is safe");
    expect(content).not.toContain("[thread:q-2042:A:u37,u38]");
    expect(content).not.toContain("[thread:main:A:u37,u38]");
  });

  it("rejects malformed persisted semantic diagnostics", () => {
    expect(
      isLeaderAnswerRouteDiagnostic({
        reason: "multiple_owners",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u1", "u2"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u1", "u2"] }],
      }),
    ).toBe(false);
    expect(
      isLeaderAnswerRouteDiagnostic({
        reason: "route_control_conflict",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u1", "u2"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u1"] }],
      }),
    ).toBe(false);
    expect(
      isLeaderAnswerRouteDiagnostic({
        reason: "missing_association",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u1"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u1"] }],
      }),
    ).toBe(false);
    expect(
      isLeaderAnswerRouteDiagnostic({
        reason: "missing_association",
        selectedThreadKey: "q-2042",
        answerUserMessageIds: ["u1"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u1"] }],
        missingAssociationUserMessageIds: ["u1"],
      }),
    ).toBe(false);
    expect(
      isLeaderAnswerRouteDiagnostic({
        reason: "missing_association",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u1", "u2", "u3"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u1", "u2", "u3"] }],
        missingAssociationUserMessageIds: ["u3", "u1"],
      }),
    ).toBe(false);
    expect(
      isLeaderAnswerRouteDiagnostic({
        reason: "disallowed_main_backfill",
        selectedThreadKey: "main",
        answerUserMessageIds: ["u1"],
        ownerGroups: [{ threadKey: "main", userMessageIds: ["u1"] }],
      }),
    ).toBe(false);
    expect(
      isLeaderAnswerRouteDiagnostic({
        reason: "missing_association",
        selectedThreadKey: "q-2044",
        answerUserMessageIds: ["u1", "u2"],
        ownerGroups: [{ threadKey: "q-2042", userMessageIds: ["u2", "u1"] }],
        missingAssociationUserMessageIds: ["u1"],
      }),
    ).toBe(false);
  });
});
