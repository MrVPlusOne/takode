// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { getHashLocationSnapshot, useHashLocation } from "./hash-location.js";

function HashReader({ label }: { label: string }) {
  return <div data-testid={label}>{useHashLocation()}</div>;
}

describe("hash-location", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/#/session/s1");
  });

  it("shares one raw hashchange listener across hook consumers", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const view = render(
      <>
        <HashReader label="first" />
        <HashReader label="second" />
      </>,
    );

    expect(addSpy.mock.calls.filter(([type]) => type === "hashchange")).toHaveLength(1);
    expect(screen.getByTestId("first")).toHaveTextContent("#/session/s1");
    expect(screen.getByTestId("second")).toHaveTextContent("#/session/s1");

    view.unmount();
    expect(removeSpy.mock.calls.filter(([type]) => type === "hashchange")).toHaveLength(1);
  });

  it("publishes browser hash changes to every consumer", async () => {
    render(
      <>
        <HashReader label="first" />
        <HashReader label="second" />
      </>,
    );

    window.location.hash = "#/session/s1/msg/m-7?thread=q-9";

    await waitFor(() => {
      expect(screen.getByTestId("first")).toHaveTextContent("#/session/s1/msg/m-7?thread=q-9");
      expect(screen.getByTestId("second")).toHaveTextContent("#/session/s1/msg/m-7?thread=q-9");
    });
    expect(getHashLocationSnapshot()).toBe("#/session/s1/msg/m-7?thread=q-9");
  });
});
