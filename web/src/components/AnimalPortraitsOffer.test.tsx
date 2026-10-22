// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getAnimalPortraitsOffer: vi.fn(),
  acceptAnimalPortraitsOffer: vi.fn(),
  dismissAnimalPortraitsOffer: vi.fn(),
}));
vi.mock("../api/animal-portraits-offer.js", () => api);
const refreshActiveSessionMetadata = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../session-list-hydration.js", () => ({ refreshActiveSessionMetadata }));

import { AnimalPortraitsOffer } from "./AnimalPortraitsOffer.js";

// The server decides whether the one-time offer shows; the strip only reports the user's answer.
describe("AnimalPortraitsOffer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAnimalPortraitsOffer.mockResolvedValue({ show: true });
    api.acceptAnimalPortraitsOffer.mockResolvedValue({ reassignedLeaders: 2 });
    api.dismissAnimalPortraitsOffer.mockResolvedValue({ ok: true });
  });

  it("renders nothing when the server does not offer it", async () => {
    api.getAnimalPortraitsOffer.mockResolvedValue({ show: false });
    const { container } = render(<AnimalPortraitsOffer />);
    await waitFor(() => expect(api.getAnimalPortraitsOffer).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("switches all leaders and refreshes the session list to show their new portraits", async () => {
    render(<AnimalPortraitsOffer />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch all leaders" }));

    await waitFor(() => expect(screen.queryByTestId("animal-portraits-offer")).toBeNull());
    expect(api.acceptAnimalPortraitsOffer).toHaveBeenCalledWith(true);
    expect(refreshActiveSessionMetadata).toHaveBeenCalledWith({ force: true });
  });

  it("can switch new leaders only", async () => {
    api.acceptAnimalPortraitsOffer.mockResolvedValue({ reassignedLeaders: 0 });
    render(<AnimalPortraitsOffer />);
    fireEvent.click(await screen.findByRole("button", { name: "New leaders only" }));

    await waitFor(() => expect(screen.queryByTestId("animal-portraits-offer")).toBeNull());
    expect(api.acceptAnimalPortraitsOffer).toHaveBeenCalledWith(false);
    expect(refreshActiveSessionMetadata).not.toHaveBeenCalled();
  });

  it("keeps the strip with an error when the switch fails", async () => {
    api.acceptAnimalPortraitsOffer.mockRejectedValue(new Error("Server unreachable"));
    render(<AnimalPortraitsOffer />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch all leaders" }));

    expect(await screen.findByText("Server unreachable")).toBeInTheDocument();
    expect(screen.getByTestId("animal-portraits-offer")).toBeInTheDocument();
  });

  it("hides on Dismiss and records it on the server", async () => {
    render(<AnimalPortraitsOffer />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(screen.queryByTestId("animal-portraits-offer")).toBeNull();
    expect(api.dismissAnimalPortraitsOffer).toHaveBeenCalled();
  });
});
