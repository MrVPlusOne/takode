import { describe, expect, it } from "vitest";
import { CodexUpstreamProgressProxy } from "./codex-upstream-progress-proxy.js";
import type { CodexUpstreamProgressState } from "./session-types.js";

describe("Codex upstream progress proxy", () => {
  it("forwards SSE unchanged while emitting only sanitized metadata and safe summary content", async () => {
    const emitted: CodexUpstreamProgressState[] = [];
    const sse = [
      "event: response.created",
      'data: {"type":"response.created","response":{"status":"in_progress"},"prompt":"SECRET_PROMPT"}',
      "",
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","item":{"type":"reasoning","reasoning_text":"PRIVATE_THOUGHT","summary":[]}}',
      "",
      "event: response.reasoning_summary_text.delta",
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Safe summary chunk.","output_text":"MODEL_OUTPUT"}',
      "",
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"MODEL_OUTPUT"}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"status":"completed"},"authorization":"SECRET_TOKEN"}',
      "",
    ].join("\n");
    const proxy = new CodexUpstreamProgressProxy({
      port: 3456,
      emitProgress: (_sessionId, progress) => emitted.push(progress),
      tokenFactory: (() => {
        const tokens = ["token-1", "request-1"];
        return () => tokens.shift() || "extra-token";
      })(),
      now: (() => {
        let now = 1000;
        return () => (now += 10);
      })(),
      fetchImpl: async () =>
        new Response(sse, {
          headers: { "content-type": "text/event-stream" },
        }),
    });
    const baseUrl = proxy.registerSessionUpstream("session-1", "https://nbagents.example/v1");
    const token = baseUrl.split("/").at(-2)!;

    const response = await proxy.handleRequest(
      new Request("http://127.0.0.1:3456/api/codex-upstream-progress-proxy/" + token + "/v1/responses"),
      token,
      "/v1/responses",
    );

    expect(await response.text()).toBe(sse);
    expect(emitted.map((event) => event.phase)).toEqual([
      "stream_start",
      "response_created",
      "reasoning_started",
      "safe_content_delta",
      "response_completed",
      "stream_done",
    ]);
    expect(emitted.at(-2)).toMatchObject({
      source: "copilot",
      active: false,
      event_type: "response.completed",
      has_safe_content: true,
      safe_content: "Safe summary chunk.",
      status: "completed",
    });
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain("SECRET_PROMPT");
    expect(serialized).not.toContain("PRIVATE_THOUGHT");
    expect(serialized).not.toContain("MODEL_OUTPUT");
    expect(serialized).not.toContain("SECRET_TOKEN");
  });

  it("rejects unknown proxy tokens without forwarding", async () => {
    let fetched = false;
    const proxy = new CodexUpstreamProgressProxy({
      port: 3456,
      emitProgress: () => {},
      fetchImpl: async () => {
        fetched = true;
        return new Response("unexpected");
      },
    });

    const response = await proxy.handleRequest(
      new Request("http://127.0.0.1:3456/api/codex-upstream-progress-proxy/missing/v1/responses"),
      "missing",
      "/v1/responses",
    );

    expect(response.status).toBe(404);
    expect(fetched).toBe(false);
  });
});
