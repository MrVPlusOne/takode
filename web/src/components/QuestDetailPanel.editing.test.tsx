// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { QuestDetailPanel } from "./QuestDetailPanel.js";

const quest: QuestmasterTask = {
  id: "q-42-v2",
  questId: "q-42",
  version: 2,
  title: "Edit quest wording",
  description: "Keep the existing editor working.",
  status: "refined",
  createdAt: 1,
  updatedAt: 2,
  tags: ["ui", "bugfix"],
};

describe("QuestDetailPanel editing from on-demand details", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useStore.getState().reset();
    vi.spyOn(api, "getSettings").mockResolvedValue({ editorConfig: { editor: "none" } } as Awaited<
      ReturnType<typeof api.getSettings>
    >);
    vi.spyOn(api, "getQuestValidated").mockResolvedValue({ status: "not-modified", etag: null });
    vi.spyOn(api, "patchQuest").mockResolvedValue(quest);
  });

  it("keeps fetched details editable and saves through the authoritative response without a list entry", async () => {
    // The real detail endpoint fills questDetails, not the bounded quest list.
    vi.mocked(api.getQuestValidated).mockResolvedValueOnce({ status: "fresh", data: quest, etag: null });
    const savedQuest = { ...quest, version: 3, title: "Updated wording", description: "Updated description." };
    vi.mocked(api.patchQuest).mockResolvedValue(savedQuest);
    useStore.setState({ questOverlayId: quest.questId });
    render(<QuestDetailPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue(quest.title), { target: { value: savedQuest.title } });
    fireEvent.change(screen.getByPlaceholderText("Add a description..."), {
      target: { value: savedQuest.description },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.patchQuest).toHaveBeenCalledWith(quest.questId, {
        title: savedQuest.title,
        description: savedQuest.description,
        tags: quest.tags,
      }),
    );
    await screen.findByRole("button", { name: "Edit" });
    expect(screen.getByText(savedQuest.description)).toBeVisible();
    expect(useStore.getState().questDetails.get(quest.questId)).toEqual(savedQuest);
    expect(useStore.getState().quests).toEqual([]);
  });

  it("preserves tags from the displayed detail when an older list entry disagrees", async () => {
    // A cached list must not supply mutation fields over the current displayed body.
    useStore.setState({
      questOverlayId: quest.questId,
      questDetails: new Map([[quest.questId, quest]]),
      quests: [{ ...quest, version: 1, tags: ["outdated"] }],
    });
    render(<QuestDetailPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.patchQuest).toHaveBeenCalledWith(quest.questId, {
        title: quest.title,
        description: quest.description,
        tags: quest.tags,
      }),
    );
  });

  it.each(["Cancel", "Escape"])("discards only the local draft on %s", async (action) => {
    // Cancelling must neither close the detail dialog nor patch durable quest data.
    useStore.setState({ questOverlayId: quest.questId, questDetails: new Map([[quest.questId, quest]]) });
    render(<QuestDetailPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue(quest.title), { target: { value: "Unsaved draft" } });
    if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await screen.findByRole("button", { name: "Edit" });
    expect(api.patchQuest).not.toHaveBeenCalled();
    expect(useStore.getState().questOverlayId).toBe(quest.questId);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue(quest.title)).toBeVisible();
  });

  it("keeps drafts for unchanged detail refreshes and invalidates them for a newer detail version", async () => {
    // Preserve the conflict guard using the same on-demand source the dialog renders.
    useStore.setState({ questOverlayId: quest.questId, questDetails: new Map([[quest.questId, quest]]) });
    render(<QuestDetailPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue(quest.title), { target: { value: "Unsaved draft" } });
    act(() => useStore.getState().upsertQuestDetail({ ...quest }));
    expect(screen.getByDisplayValue("Unsaved draft")).toBeVisible();

    act(() => useStore.getState().upsertQuestDetail({ ...quest, version: 3, title: "Remote update" }));
    await screen.findByText("Quest was updated remotely. Your edits were discarded to avoid conflicts.");
    expect(screen.queryByDisplayValue("Unsaved draft")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
    expect(api.patchQuest).not.toHaveBeenCalled();
  });

  it("retains the editable draft and displays a failed save", async () => {
    // A rejected server mutation must not discard the user's unsaved text.
    vi.mocked(api.patchQuest).mockRejectedValue(new Error("Save failed"));
    useStore.setState({ questOverlayId: quest.questId, questDetails: new Map([[quest.questId, quest]]) });
    render(<QuestDetailPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue(quest.title), { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Save failed");
    expect(screen.getByDisplayValue("Unsaved draft")).toBeVisible();
    expect(useStore.getState().questDetails.get(quest.questId)).toEqual(quest);
  });
});
