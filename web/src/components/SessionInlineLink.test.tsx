// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../store.js";
import { SessionInlineLink } from "./SessionInlineLink.js";

describe("SessionInlineLink", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.history.replaceState({}, "", "/#/questmaster");
  });

  it("can target a leader quest thread while keeping readable session refs", () => {
    useStore.getState().setSdkSessions([
      {
        sessionId: "leader-abc",
        sessionNum: 7,
        state: "connected",
        cwd: "/repo",
        createdAt: 1,
        isOrchestrator: true,
      } as any,
    ]);

    render(
      <SessionInlineLink sessionId="leader-abc" threadKey="q-42">
        #7
      </SessionInlineLink>,
    );

    const link = screen.getByRole("link", { name: "#7" });
    expect(link).toHaveAttribute("href", "#/session/7?thread=q-42");

    fireEvent.click(link);

    expect(window.location.hash).toBe("#/session/7?thread=q-42");
  });

  it("keeps context-free links plain", () => {
    render(<SessionInlineLink sessionId="plain-session">plain</SessionInlineLink>);

    const link = screen.getByRole("link", { name: "plain" });
    expect(link).toHaveAttribute("href", "#/session/plain-session");
  });
});
