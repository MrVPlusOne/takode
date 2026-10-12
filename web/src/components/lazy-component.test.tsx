// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { lazyComponent } from "./lazy-component.js";

// Rarely used pages load on first use. After Restart Server, a tab still running the old build
// may ask for a chunk the new server no longer has; it must offer a Reload, not crash the app.
describe("lazyComponent", () => {
  it("renders the loaded component with its props", async () => {
    const Page = lazyComponent(async () => ({ label }: { label: string }) => <p>{label}</p>);
    render(<Page label="Questmaster" />);
    expect(await screen.findByText("Questmaster")).toBeInTheDocument();
  });

  it("offers a reload when the chunk cannot be loaded", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const Page = lazyComponent<object>(() =>
      Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
    );
    render(<Page />);
    expect(await screen.findByRole("button", { name: "Reload" })).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
