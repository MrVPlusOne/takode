import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `takode read --raw` and `--quote` exist so leaders can carry a user's exact
// words into quests without parsing JSON. These tests run the real CLI against
// a mock server shaped like the /sessions/:id/messages/:ref route.

const LONG_LINE_COUNT = 250;
const longText = Array.from({ length: LONG_LINE_COUNT }, (_, i) => `line ${i + 1}`).join("\n");
const ts = new Date(2026, 9, 23, 23, 39).getTime();

type MockMessage = { idx: number; type: string; content: string; agentSource?: { sessionId: string } };

const messages: Record<string, MockMessage> = {
  u651: { idx: 1234, type: "user_message", content: "First paragraph.\n\nSecond paragraph.\n[transcribed]" },
  u653: { idx: 1240, type: "user_message", content: "A follow-up." },
  u700: { idx: 1300, type: "user_message", content: longText },
  "5": { idx: 5, type: "user_message", content: "herd note", agentSource: { sessionId: "herd-events" } },
};

let server: Server | null = null;
const requests: string[] = [];

afterEach(() => {
  server?.close();
  server = null;
  requests.length = 0;
});

/** Serve read responses paged by lines the way the real route does. */
async function startServer(): Promise<number> {
  server = createServer((req, res) => {
    const url = new URL(req.url || "", "http://localhost");
    requests.push(`${url.pathname}${url.search}`);
    const match = url.pathname.match(/^\/api\/sessions\/(\w+)\/messages\/(\w+)$/);
    const message = match ? messages[match[2]!] : undefined;
    if (!match || !message) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 200);
    const lines = message.content.split("\n");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        idx: message.idx,
        type: message.type,
        ts,
        totalLines: lines.length,
        offset,
        limit,
        content: lines.slice(offset, offset + limit).join("\n"),
        // Only known when the caller names a real session; "leader" stands in for a session id.
        ...(match[1] === "leader" ? { sessionNum: 2851 } : {}),
        rawMessage: { type: message.type, content: message.content, agentSource: message.agentSource },
      }),
    );
  });
  server.listen(0);
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function runTakode(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./takode.ts", import.meta.url)), ...args], {
    env: { ...process.env, COMPANION_SESSION_ID: "leader-session", COMPANION_AUTH_TOKEN: "token" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end();
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
}

describe("takode read --raw and --quote", () => {
  it("prints only the exact full text with --raw, fetching every line of a long message", async () => {
    const port = await startServer();

    const short = await runTakode(["read", "2851", "u651", "--raw", "--port", String(port)]);
    const long = await runTakode(["read", "2851", "u700", "--raw", "--port", String(port)]);

    expect(short.status).toBe(0);
    expect(short.stdout).toBe("First paragraph.\n\nSecond paragraph.\n[transcribed]\n");
    // The first page holds 200 lines; the CLI asks again for all 250 instead of cutting the text.
    expect(long.status).toBe(0);
    expect(long.stdout).toBe(`${longText}\n`);
    expect(requests).toContain(`/api/sessions/2851/messages/u700?limit=${LONG_LINE_COUNT}`);
  });

  it("quotes a message as Markdown with sender, time and a link back to it", async () => {
    const port = await startServer();

    const result = await runTakode(["read", "2851", "u651", "--quote", "--port", String(port)]);

    expect(result.status).toBe(0);
    // Blank lines inside the message stay inside the quote as a bare ">".
    expect(result.stdout).toBe(
      [
        "> User, Fri, Oct 23 23:39 ([#2851 u651](session:2851:1234)):",
        ">",
        "> First paragraph.",
        ">",
        "> Second paragraph.",
        "> [transcribed]",
        "",
      ].join("\n"),
    );
  });

  it("quotes several messages in order and links by the server's session number", async () => {
    const port = await startServer();

    const result = await runTakode(["read", "leader", "u651", "u653", "--quote", "--port", String(port)]);

    expect(result.status).toBe(0);
    const [first, second] = result.stdout.trimEnd().split("\n\n");
    expect(first).toContain("([#2851 u651](session:2851:1234)):");
    expect(second).toBe("> User, Fri, Oct 23 23:39 ([#2851 u653](session:2851:1240)):\n>\n> A follow-up.");
  });

  it("labels quotes of non-human messages by their source and history index", async () => {
    const port = await startServer();

    const result = await runTakode(["read", "2851", "5", "--quote", "--port", String(port)]);

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe("> Herd, Fri, Oct 23 23:39 ([#2851 msg 5](session:2851:5)):");
  });

  it("returns an array from --json when several messages are named", async () => {
    const port = await startServer();

    const single = await runTakode(["read", "2851", "u653", "--json", "--port", String(port)]);
    const several = await runTakode(["read", "2851", "u651", "u653", "--json", "--port", String(port)]);

    expect(JSON.parse(single.stdout)).toMatchObject({ idx: 1240, content: "A follow-up." });
    expect(JSON.parse(several.stdout).map((m: { idx: number }) => m.idx)).toEqual([1234, 1240]);
  });

  it("rejects combined output modes and paging with whole-message modes", async () => {
    const port = await startServer();

    const modes = await runTakode(["read", "2851", "u651", "--raw", "--quote", "--port", String(port)]);
    const paging = await runTakode(["read", "2851", "u651", "--raw", "--limit", "5", "--port", String(port)]);

    expect(modes.status).not.toBe(0);
    expect(modes.stderr).toContain("Use only one of --raw, --quote and --json.");
    expect(paging.status).not.toBe(0);
    expect(paging.stderr).toContain("--raw prints whole messages");
    expect(requests).toEqual([]);
  });
});
