// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { useQuestDetailRecord } from "./useQuestDetailRecord.js";

function quest(): QuestmasterTask {
  return {
    id: "q-42",
    questId: "q-42",
    version: 2,
    title: "Outcome refresh",
    description: "Test",
    status: "in_progress",
    sessionId: "worker",
    claimedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function Harness() {
  useQuestDetailRecord("q-42");
  return null;
}

describe("useQuestDetailRecord live invalidation", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({
      questDetails: new Map([["q-42", quest()]]),
      questTitlePreviews: new Map([
        [
          "q-42",
          {
            questId: "q-42",
            title: "Outcome refresh",
            version: 2,
            updatedAt: 1,
            outcomeRevision: 1,
          } as import("../types.js").QuestTitlePreview,
        ],
      ]),
    });
    vi.restoreAllMocks();
  });

  it("revalidates an open exact quest when a live quest update advances its freshness", async () => {
    const getQuest = vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: '"same"' });
    render(<Harness />);
    await waitFor(() => expect(getQuest).toHaveBeenCalledTimes(1));

    useStore.getState().upsertQuestTitlePreview({
      questId: "q-42",
      title: "Outcome refresh",
      version: 2,
      updatedAt: 2,
    });
    await waitFor(() => expect(getQuest).toHaveBeenCalledTimes(2));
  });

  it("revalidates same-millisecond Outcome revisions when only the monotonic token advances", async () => {
    const getQuest = vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: '"same"' });
    render(<Harness />);
    await waitFor(() => expect(getQuest).toHaveBeenCalledTimes(1));

    useStore.getState().upsertQuestTitlePreview({
      questId: "q-42",
      title: "Outcome refresh",
      version: 2,
      updatedAt: 1,
      outcomeRevision: 2,
    } as import("../types.js").QuestTitlePreview);

    await waitFor(() => expect(getQuest).toHaveBeenCalledTimes(2));
  });
});
