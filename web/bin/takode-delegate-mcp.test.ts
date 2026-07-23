import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANION_AUTH_TOKEN_HEADER, COMPANION_SESSION_ID_HEADER } from "../server/routes/auth.js";
import { callTakode, registerTakodeDelegateTools } from "./takode-delegate-mcp.js";

describe("takode delegate MCP bridge", () => {
  const originalEnv = { ...process.env };
  const tempRoots: string[] = [];

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("sends both required Takode auth headers on forwarded tool calls", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.COMPANION_PORT = "3456";
    process.env.COMPANION_SESSION_ID = "session-abc";
    process.env.COMPANION_AUTH_TOKEN = "token-secret";

    const result = await callTakode("/api/sessions/session-abc/delegates/command", { command: "rg foo" });

    expect(result).toEqual({ content: [{ type: "text", text: "ok" }], isError: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      "content-type": "application/json",
      [COMPANION_SESSION_ID_HEADER]: "session-abc",
      [COMPANION_AUTH_TOKEN_HEADER]: "token-secret",
    });
  });

  it("registers the same delegate tool set for parent and forked child sessions", () => {
    const tools: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => {
        tools.push(name);
      }),
    };

    registerTakodeDelegateTools(server as any, "session-abc");

    expect(tools).toEqual(["delegate_command", "end_delegation"]);
  });

  it("falls back to the session Codex config env when the MCP subprocess env is incomplete", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "takode-delegate-mcp-env-"));
    tempRoots.push(codexHome);
    await writeFile(
      join(codexHome, "config.toml"),
      [
        "[mcp_servers.takode_delegate]",
        `command = ${JSON.stringify(process.execPath)}`,
        'args = ["/repo/web/bin/takode-delegate-mcp.ts"]',
        "enabled = true",
        "[mcp_servers.takode_delegate.env]",
        'COMPANION_AUTH_TOKEN = "token-from-config"',
        'COMPANION_PORT = "3471"',
        'COMPANION_SESSION_ID = "child-session"',
        'TAKODE_DELEGATE_ID = "del_123"',
        'TAKODE_DELEGATE_PARENT_SESSION_ID = "parent-session"',
        'TAKODE_DELEGATE_ROLE = "child"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      return new Response(JSON.stringify({ text: "resolved" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.COMPANION_PORT;
    delete process.env.COMPANION_SESSION_ID;
    delete process.env.COMPANION_AUTH_TOKEN;
    process.env.CODEX_HOME = codexHome;

    const result = await callTakode("/api/sessions/child-session/delegates/end", {
      delegateId: "del_123",
      summary: "done",
    });

    expect(result).toEqual({ content: [{ type: "text", text: "resolved" }], isError: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3471/api/sessions/child-session/delegates/end");
    expect((init as RequestInit).headers).toMatchObject({
      [COMPANION_SESSION_ID_HEADER]: "child-session",
      [COMPANION_AUTH_TOKEN_HEADER]: "token-from-config",
    });
  });
});
