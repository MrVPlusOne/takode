// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  installQuestmasterPageTestHooks,
  mockCreateQuest,
  mockState,
  mockUploadStandaloneQuestImage,
} from "./QuestmasterPage.test-harness.js";

vi.mock("../api.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockApiModule());
vi.mock("../utils/questmaster-view-state.js", async (importOriginal) =>
  (await import("./QuestmasterPage.test-harness.js")).mockViewStateModule(await importOriginal()),
);
vi.mock("../utils/highlight.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockHighlightModule());
vi.mock("../store.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockStoreModule());

import { QuestmasterPage } from "./QuestmasterPage.js";

installQuestmasterPageTestHooks();

function renderQuestmaster(props: { isActive?: boolean } = {}) {
  return render(<QuestmasterPage isActive={false} {...props} />);
}

describe("QuestmasterPage quest creation", () => {
  it("opens quest overlay for newly created quest", async () => {
    // After creating a quest, openQuestOverlay should be called with the new quest's ID.
    mockState.currentSessionId = "session-msi";
    mockState.sessions.set("session-msi", { memorySessionSpaceSlug: "MSI" });
    renderQuestmaster();

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    fireEvent.change(screen.getByPlaceholderText("Quest title"), {
      target: { value: "Investigate reconnect jitter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreateQuest).toHaveBeenCalledWith({
        title: "Investigate reconnect jitter",
        description: undefined,
        tags: undefined,
        sessionSpaceSlug: "MSI",
        images: undefined,
      });
    });
    await waitFor(() => {
      expect(mockState.questOverlayId).toBe("q-3");
    });
    // Note: the real component dismisses the create form when questOverlayId
    // becomes non-null, but the mock store isn't reactive so the component
    // doesn't re-render here. The important assertion (overlay ID) is above.
  });

  it("keeps the New Quest title field out of textarea auto-resize work", () => {
    // The typing-latency fix relies on the title being a single-line input
    // inside a paint/layout containment boundary instead of resizing a
    // textarea above the full Questmaster list on every keystroke.
    renderQuestmaster();

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));

    expect(screen.getByTestId("questmaster-create-form")).toHaveStyle({ contain: "layout paint style" });
    expect(screen.getByPlaceholderText("Quest title").tagName).toBe("INPUT");
  });

  it("preserves New Quest drafts across hide and reopen paths", async () => {
    // The create form stays mounted while hidden, so draft text/images survive
    // incidental closes without returning typing state to the full page.
    renderQuestmaster();

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    const titleInput = screen.getByPlaceholderText("Quest title");
    const descriptionInput = screen.getByPlaceholderText("Description (optional)");
    fireEvent.change(titleInput, { target: { value: "Draft reconnect follow-up" } });
    fireEvent.change(descriptionInput, { target: { value: "Keep this draft through closes." } });

    const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    const file = new File(["quest-image"], "draft.png", { type: "image/png" });
    fireEvent.change(fileInput!, { target: { files: [file] } });
    expect(await screen.findByAltText("draft.png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    expect(screen.getByTestId("questmaster-create-form")).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    expect(screen.getByPlaceholderText("Quest title")).toHaveValue("Draft reconnect follow-up");
    expect(screen.getByPlaceholderText("Description (optional)")).toHaveValue("Keep this draft through closes.");
    expect(screen.getByAltText("draft.png")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText("Quest title"), { key: "Escape" });
    expect(screen.getByTestId("questmaster-create-form")).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    expect(screen.getByPlaceholderText("Quest title")).toHaveValue("Draft reconnect follow-up");
    expect(screen.getByPlaceholderText("Description (optional)")).toHaveValue("Keep this draft through closes.");
    expect(screen.getByAltText("draft.png")).toBeInTheDocument();

    act(() => {
      window.location.hash = "#/questmaster?quest=q-1";
      window.dispatchEvent(new Event("hashchange"));
    });
    await waitFor(() => expect(screen.getByTestId("questmaster-create-form")).toHaveClass("hidden"));

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    expect(screen.getByPlaceholderText("Quest title")).toHaveValue("Draft reconnect follow-up");
    expect(screen.getByPlaceholderText("Description (optional)")).toHaveValue("Keep this draft through closes.");
    expect(screen.getByAltText("draft.png")).toBeInTheDocument();
  });

  it("preserves New Quest draft text but clears draft images on Cancel", async () => {
    // Preserve the pre-extraction behavior: Cancel hid the form and cleared
    // uploaded draft images, while title/description draft text stayed around.
    renderQuestmaster();

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    fireEvent.change(screen.getByPlaceholderText("Quest title"), { target: { value: "Cancel-safe draft" } });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), {
      target: { value: "Text should remain after Cancel." },
    });

    const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    const file = new File(["quest-image"], "cancel-cleared.png", { type: "image/png" });
    fireEvent.change(fileInput!, { target: { files: [file] } });
    expect(await screen.findByAltText("draft.png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("questmaster-create-form")).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    expect(screen.getByPlaceholderText("Quest title")).toHaveValue("Cancel-safe draft");
    expect(screen.getByPlaceholderText("Description (optional)")).toHaveValue("Text should remain after Cancel.");
    expect(screen.queryByAltText("draft.png")).not.toBeInTheDocument();
  });

  it("does not extract numeric-leading session references as quest tags on create", async () => {
    // Numeric-leading references like #123 often point to sessions, so create
    // flow extraction should keep them out of the saved tag list.
    renderQuestmaster();

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));
    fireEvent.change(screen.getByPlaceholderText("Quest title"), {
      target: { value: "Follow session #123 and tag #alpha" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), {
      target: { value: "Need context from #456 before #beta ships." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockCreateQuest).toHaveBeenCalledWith({
        title: "Follow session #123 and tag #alpha",
        description: "Need context from #456 before #beta ships.",
        tags: ["alpha", "beta"],
        images: undefined,
      });
    });
  });

  it("opens create-form image previews in a lightbox instead of a new tab", async () => {
    renderQuestmaster();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    fireEvent.click(screen.getByRole("button", { name: /New Quest/i }));

    const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    const file = new File(["quest-image"], "draft.png", { type: "image/png" });
    fireEvent.change(fileInput!, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUploadStandaloneQuestImage).toHaveBeenCalledWith(file);
    });

    fireEvent.click(await screen.findByAltText("draft.png"));

    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/api/quests/_images/img-upload");

    openSpy.mockRestore();
  });
});
