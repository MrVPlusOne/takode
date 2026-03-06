// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";

const mockListEnvs = vi.fn();
const mockGetContainerStatus = vi.fn();
const mockGetContainerImages = vi.fn();
const mockUpdateEnv = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    listEnvs: () => mockListEnvs(),
    getContainerStatus: () => mockGetContainerStatus(),
    getContainerImages: () => mockGetContainerImages(),
    updateEnv: (...args: unknown[]) => mockUpdateEnv(...args),
    createEnv: vi.fn(),
    deleteEnv: vi.fn(),
    buildEnvImage: vi.fn(),
    getEnvBuildStatus: vi.fn(),
  },
}));

import { EnvManager } from "./EnvManager.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockListEnvs.mockResolvedValue([
    {
      name: "Companion",
      slug: "companion",
      variables: { CLAUDE_CODE_OAUTH_TOKEN: "tok" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);
  mockGetContainerStatus.mockResolvedValue({ available: true, version: "27.5.1" });
  mockGetContainerImages.mockResolvedValue(["companion-dev:latest"]);
  mockUpdateEnv.mockResolvedValue({});
});

describe("EnvManager existing env edit", () => {
  it("shows Docker controls and persists baseImage update", async () => {
    const view = render(<EnvManager embedded />);
    const scope = within(view.container);

    await scope.findByText("Companion");
    fireEvent.click(scope.getByRole("button", { name: "Edit" }));

    // Docker controls are visible in existing env edit mode.
    const baseImageSelect = scope.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(baseImageSelect.value).toBe("");
    fireEvent.change(baseImageSelect, { target: { value: "companion-dev:latest" } });

    fireEvent.click(scope.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateEnv).toHaveBeenCalledWith(
        "companion",
        expect.objectContaining({ baseImage: "companion-dev:latest" }),
      );
    });
  });
});
