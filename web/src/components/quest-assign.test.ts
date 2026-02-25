import { describe, expect, it } from "vitest";
import { buildQuestAssignDraft } from "./quest-assign.js";

describe("buildQuestAssignDraft", () => {
  it("uses one backend-agnostic claim+work instruction", () => {
    expect(buildQuestAssignDraft("q-64")).toBe(
      "Please run /quest claim q-64, then immediately start working on this quest.",
    );
  });

  it("keeps the same draft regardless of backend", () => {
    expect(buildQuestAssignDraft("q-64")).toBe(
      "Please run /quest claim q-64, then immediately start working on this quest.",
    );
  });
});
