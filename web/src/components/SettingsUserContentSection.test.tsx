// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsUserContentSection } from "./SettingsUserContentSection.js";
import type { UserContentStatus } from "../user-content.js";

/** A fake of GET /api/hosts and the user content routes, in the shapes the server answers with. */
function serve(status: UserContentStatus) {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({}), { status: 200 });
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

const emptyResult = {
  status: "current",
  instructionFiles: [],
  skills: { linked: [], removed: [], shadowedByTakode: [], conflicts: [], takenOver: [] },
  notes: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsUserContentSection", () => {
  it("offers a one-time import from each connected machine and imports only after a confirming second click", async () => {
    const posts = serve({
      storeRoot: "/home/u/.companion/user-content",
      storeExists: false,
      storeEmpty: true,
      machines: [],
    });
    render(<SettingsUserContentSection />);

    const button = await screen.findByRole("button", { name: "Import from laptop" });
    fireEvent.click(button);
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm import from laptop" }));

    await waitFor(() => expect(posts).toEqual([{ url: "/api/user-content/import", body: { hostId: "h1" } }]));
  });

  it("lists what waits for approval on a machine and takes it over after confirmation", async () => {
    const posts = serve({
      storeRoot: "/s",
      storeExists: true,
      storeEmpty: false,
      machines: [
        {
          hostId: null,
          at: 1,
          result: {
            ...emptyResult,
            instructionFiles: [
              {
                backend: "claude",
                path: "/home/u/.claude/CLAUDE.md",
                state: "conflict",
                detail: "not written by Takode",
              },
              { backend: "codex", path: "/home/u/.codex/AGENTS.md", state: "current" },
            ],
            skills: { ...emptyResult.skills, conflicts: ["/home/u/.agents/skills/mine"] },
          },
        },
        { hostId: "h1", at: 1, result: emptyResult },
      ],
    });
    render(<SettingsUserContentSection />);

    expect(await screen.findByText("/home/u/.claude/CLAUDE.md (not written by Takode)")).toBeTruthy();
    expect(screen.getByText("/home/u/.agents/skills/mine")).toBeTruthy();
    expect(screen.getByText("Up to date")).toBeTruthy(); // the laptop row
    fireEvent.click(screen.getByRole("button", { name: "Let Takode manage these" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: replace with the store's copy" }));

    await waitFor(() => expect(posts).toEqual([{ url: "/api/user-content/take-over", body: { hostId: null } }]));
  });
});
