// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsUserContentSection } from "./SettingsUserContentSection.js";
import { requestUserContentFocus, type UserContentStatus } from "../user-content.js";

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

const store = { instructions: "/home/u/.companion/user-instructions", skills: "/home/u/.companion/user-skills" };

describe("SettingsUserContentSection", () => {
  it("previews each machine and imports only after a confirming second click", async () => {
    const posts = serve({
      store,
      storeExists: false,
      storeEmpty: true,
      machines: [],
      importCandidates: [
        { hostId: null, summary: { claudeChars: 0, codexChars: 0, sharedInstructions: false, skills: [] } },
        {
          hostId: "h1",
          summary: { claudeChars: 12_000, codexChars: 12_000, sharedInstructions: true, skills: ["a", "b"] },
        },
      ],
    });
    render(<SettingsUserContentSection />);

    // The preview tells the user which machine holds their real content before anything is copied.
    expect(await screen.findByText("rules 12 KB (one file for Claude and Codex); 2 skills: a, b")).toBeTruthy();
    expect(screen.getByText("no rules; no skills")).toBeTruthy();
    const laptopButton = screen.getAllByRole("button", { name: "Import from here" })[1];
    fireEvent.click(laptopButton);
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm import from laptop" }));

    await waitFor(() => expect(posts).toEqual([{ url: "/api/user-content/import", body: { hostId: "h1" } }]));
  });

  it("shows machines still being read, and scrolls itself into view when the notice sent the user here", async () => {
    // Set up on the one-time notice must land on this section, not wherever Settings happened to scroll.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    serve({
      store,
      storeExists: false,
      storeEmpty: true,
      machines: [],
      importCandidates: [{ hostId: "h1", pending: true }],
    });
    requestUserContentFocus();
    render(<SettingsUserContentSection />);

    expect(await screen.findByText("Reading this machine's instructions and skills…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import from here" })).toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("labels what waits for approval, takes it over after confirmation and shows where backups went", async () => {
    const posts = serve({
      store,
      storeExists: true,
      storeEmpty: false,
      importCandidates: [],
      machines: [
        {
          hostId: null,
          at: 1,
          lastBackup: { dir: "/home/u/.companion/backups/user-content/2026-10-11", at: 1 },
          result: {
            ...emptyResult,
            instructionFiles: [
              {
                backend: "claude",
                path: "/home/u/.claude/CLAUDE.md",
                state: "conflict",
                detail: "differs from the store",
              },
              { backend: "codex", path: "/home/u/.codex/AGENTS.md", state: "current" },
            ],
            skills: {
              ...emptyResult.skills,
              conflicts: [{ path: "/home/u/.agents/skills/mine", detail: "differs from the store" }],
            },
          },
        },
        { hostId: "h1", at: 1, result: emptyResult },
      ],
    });
    render(<SettingsUserContentSection />);

    expect(await screen.findByText("/home/u/.claude/CLAUDE.md")).toBeTruthy();
    expect(screen.getAllByText(": differs from the store")).toHaveLength(2);
    expect(screen.getByText("/home/u/.companion/backups/user-content/2026-10-11")).toBeTruthy();
    expect(screen.getByText("Up to date")).toBeTruthy(); // the laptop row
    fireEvent.click(screen.getByRole("button", { name: "Let Takode manage these" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: replace with the store's copy" }));

    await waitFor(() => expect(posts).toEqual([{ url: "/api/user-content/take-over", body: { hostId: null } }]));
  });
});
