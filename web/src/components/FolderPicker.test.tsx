// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockListDirs = vi.fn();
vi.mock("../api.js", () => ({
  api: { listDirs: (...args: unknown[]) => mockListDirs(...args) },
}));

vi.mock("../utils/recent-dirs.js", () => ({
  getRecentDirs: () => [],
  addRecentDir: vi.fn(),
}));

import { FolderPicker } from "./FolderPicker.js";

describe("FolderPicker", () => {
  beforeEach(() => {
    mockListDirs.mockReset();
  });

  // With a remote host, the picker lists that host's folders; with no path it
  // starts wherever the host answers (its home folder).
  it("browses a remote host's folders", async () => {
    mockListDirs.mockResolvedValue({
      path: "/home/coder",
      dirs: [{ name: "app", path: "/home/coder/app" }],
      home: "/home/coder",
    });
    render(<FolderPicker initialPath="" hostId="h1" onSelect={() => {}} onClose={() => {}} />);

    expect(await screen.findByText("app")).toBeInTheDocument();
    expect(mockListDirs).toHaveBeenCalledWith(undefined, { hidden: false, hostId: "h1" });
  });

  // A host that cannot answer is reported, instead of looking like an empty
  // folder, and there is no folder to open.
  it("shows why a host's folders cannot be listed", async () => {
    mockListDirs.mockRejectedValue(new Error("Host devbox is offline"));
    render(<FolderPicker initialPath="" hostId="h1" onSelect={() => {}} onClose={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Host devbox is offline");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toBeDisabled());
  });
});
