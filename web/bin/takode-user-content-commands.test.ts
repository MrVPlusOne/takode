import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUserContent } from "./takode-user-content-commands.js";

// The commands an agent uses during setup: machine names resolve to host ids, and status
// shows what each waiting item holds that the store lacks, so the agent can confirm nothing is lost.
function serve(userContent: unknown) {
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("http://takode/api", "");
      if (init?.method === "POST") {
        posts.push({ path, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ moved: [] }));
      }
      if (path === "/hosts") {
        return new Response(JSON.stringify({ hosts: [{ id: "h1", name: "laptop" }], local: { name: "devbox" } }));
      }
      return new Response(JSON.stringify(userContent));
    }),
  );
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
  return { posts, lines };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("takode user-content", () => {
  it("resolves machine names, including the server's own, for actions", async () => {
    const { posts } = serve({});
    await handleUserContent("http://takode/api", ["remove-skills", "--machine", "laptop", "hq-notes", "--dangling"]);
    await handleUserContent("http://takode/api", ["take-over", "--machine", "devbox"]);
    expect(posts).toEqual([
      { path: "/user-content/remove-skills", body: { hostId: "h1", skills: ["hq-notes"], dangling: true } },
      { path: "/user-content/take-over", body: { hostId: null } },
    ]);
    await expect(handleUserContent("http://takode/api", ["import", "--machine", "nowhere"])).rejects.toThrow(
      /No machine named nowhere/,
    );
  });

  it("lists each waiting item with what only that machine has", async () => {
    const { lines } = serve({
      store: { instructions: "/s/i", skills: "/s/k" },
      storeExists: true,
      storeEmpty: false,
      importCandidates: [],
      machines: [
        {
          hostId: "h1",
          lastBackup: { dir: "/b/1" },
          result: {
            instructionFiles: [
              {
                path: "/l/.claude/CLAUDE.md",
                state: "conflict",
                detail: "differs from the store",
                onlyHere: ["A local rule"],
              },
            ],
            skills: {
              conflicts: [{ path: "/l/.agents/skills/x", detail: "differs from the store", onlyHere: [] }],
              shadowedByTakode: [],
            },
            notes: [],
          },
        },
      ],
    });
    await handleUserContent("http://takode/api", ["status"]);
    const text = lines.join("\n");
    expect(text).toContain("waiting: /l/.claude/CLAUDE.md (differs from the store)\n    only here: A local rule");
    expect(text).toContain("waiting: /l/.agents/skills/x (differs from the store)\n    nothing that the store lacks");
    expect(text).toContain("last backup: /b/1");
  });
});
