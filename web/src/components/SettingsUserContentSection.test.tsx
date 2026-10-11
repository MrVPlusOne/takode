// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "../store.js";
import type { SdkSessionInfo } from "../types.js";
import { requestUserContentFocus, type UserContentStatus } from "../user-content.js";
import { SettingsUserContentSection } from "./SettingsUserContentSection.js";

/** A fake of GET /api/hosts and the user content routes, in the shapes the server answers with. */
function serve(status: UserContentStatus) {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === "/api/hosts") {
        return new Response(
          JSON.stringify({
            hosts: [{ id: "h1", name: "laptop", online: true, settings: {}, commandOverrides: {} }],
            build: null,
            local: { id: "local", name: "devbox", settings: {}, node: {} },
          }),
        );
      }
      return new Response(JSON.stringify(status));
    }),
  );
  return posts;
}

const store = { instructions: "/home/u/.companion/user-instructions", skills: "/home/u/.companion/user-skills" };

beforeEach(() => {
  useStore.setState({
    sdkSessions: [
      { sessionId: "s-old", sessionNum: 3, name: "Old work", cwd: "/w" },
      { sessionId: "s-new", sessionNum: 7, name: "Fresh helper", cwd: "/w" },
      { sessionId: "s-archived", sessionNum: 5, name: "Archived", cwd: "/w", archived: true },
    ] as unknown as SdkSessionInfo[],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsUserContentSection", () => {
  it("hands the setup to the session the user picks instead of offering its own controls", async () => {
    // Setup and migration are an agent's job; the section only sends the chosen session a prompt.
    const posts = serve({ store, storeExists: false, storeEmpty: true, machines: [] });
    render(<SettingsUserContentSection />);

    expect(await screen.findByText(/Not set up yet/)).toBeTruthy();
    const picker = screen.getByRole("combobox", { name: "Session to set this up" });
    // Newest session first; archived sessions cannot take the job.
    expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Pick a session to do this…",
      "#7 Fresh helper",
      "#3 Old work",
    ]);
    fireEvent.change(picker, { target: { value: "s-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask this session to set it up" }));

    await waitFor(() =>
      expect(posts).toEqual([{ url: "/api/user-content/agent-setup", body: { sessionId: "s-new" } }]),
    );
    expect(await screen.findByText(/Sent to #7 Fresh helper/)).toBeTruthy();
  });

  it("shows each machine's state once set up", async () => {
    serve({
      store,
      storeExists: true,
      storeEmpty: false,
      machines: [
        {
          hostId: null,
          at: 1,
          result: {
            instructionFiles: [{ path: "/home/u/.claude/CLAUDE.md", state: "conflict" }],
            skills: { conflicts: [{ path: "/home/u/.agents/skills/mine" }] },
          },
        },
        { hostId: "h1", at: 1, result: { instructionFiles: [], skills: { conflicts: [] } } },
      ],
    });
    render(<SettingsUserContentSection />);

    expect(await screen.findByText("2 items waiting for your approval")).toBeTruthy();
    expect(screen.getByText("up to date")).toBeTruthy();
  });

  it("scrolls itself into view when the one-time notice sent the user here", async () => {
    // Set up on the notice must land on this section, not wherever Settings happened to scroll.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    serve({ store, storeExists: false, storeEmpty: true, machines: [] });
    requestUserContentFocus();
    render(<SettingsUserContentSection />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});
