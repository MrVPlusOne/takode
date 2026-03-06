import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmbeddedInVsCode } from "./embed-context.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isEmbeddedInVsCode", () => {
  it("returns true when the takodeHost query param is set to vscode", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?takodeHost=vscode",
      },
    });

    expect(isEmbeddedInVsCode()).toBe(true);
  });

  it("returns false for normal browser sessions", () => {
    vi.stubGlobal("window", {
      location: {
        search: "",
      },
    });

    expect(isEmbeddedInVsCode()).toBe(false);
  });
});
