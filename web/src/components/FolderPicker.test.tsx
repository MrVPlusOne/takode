// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockListDirs = vi.fn();
const mockCheckFolders = vi.fn();
vi.mock("../api.js", () => ({
  api: {
    listDirs: (...args: unknown[]) => mockListDirs(...args),
    checkFolders: (...args: unknown[]) => mockCheckFolders(...args),
  },
}));

let mockRecentDirs: string[] = [];
vi.mock("../utils/recent-dirs.js", () => ({
  getRecentDirs: () => mockRecentDirs,
  addRecentDir: vi.fn(),
}));

import { FolderPicker } from "./FolderPicker.js";

describe("FolderPicker", () => {
  beforeEach(() => {
    mockListDirs.mockReset();
    mockCheckFolders.mockReset();
    mockCheckFolders.mockImplementation(async (paths: string[]) => paths.map(() => true));
    mockRecentDirs = [];
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

  // Recent folders may have been recorded on another machine (for example when
  // the server moved to another computer); only those that are folders on the
  // machine being browsed are offered.
  it("offers only recent folders that exist on the machine being browsed", async () => {
    mockRecentDirs = ["/Users/someone/Code/app", "/home/coder/app"];
    mockCheckFolders.mockResolvedValue([false, true]);
    mockListDirs.mockResolvedValue({ path: "/home/coder", dirs: [], home: "/home/coder" });
    render(<FolderPicker initialPath="" hostId="h1" onSelect={() => {}} onClose={() => {}} />);

    expect(await screen.findByText("/home/coder/app")).toBeInTheDocument();
    expect(mockCheckFolders).toHaveBeenCalledWith(["/Users/someone/Code/app", "/home/coder/app"], "h1");
    expect(screen.queryByText("/Users/someone/Code/app")).not.toBeInTheDocument();
  });

  // A starting folder that does not exist on this machine opens the machine's
  // home folder instead of an error.
  it("starts in the home folder when the starting folder is not on the machine", async () => {
    mockListDirs.mockImplementation(async (path?: string) => {
      if (path) throw new Error("Cannot read directory");
      return { path: "/home/coder", dirs: [{ name: "app", path: "/home/coder/app" }], home: "/home/coder" };
    });
    render(<FolderPicker initialPath="/Users/someone/Code/app" hostId="h1" onSelect={() => {}} onClose={() => {}} />);

    expect(await screen.findByText("app")).toBeInTheDocument();
    expect(mockListDirs).toHaveBeenNthCalledWith(1, "/Users/someone/Code/app", { hidden: false, hostId: "h1" });
    expect(mockListDirs).toHaveBeenNthCalledWith(2, undefined, { hidden: false, hostId: "h1" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
