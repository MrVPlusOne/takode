import { describe, expect, it, vi } from "vitest";
import { copilotWebSearch } from "./takode-web-search-mcp.js";

/** A fetch stand-in that records its request and answers with this status and JSON body. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
}

// A trimmed Copilot Responses API answer: the search call, then the cited message.
const searchAnswer = {
  output: [
    { type: "web_search_call", action: { type: "search", query: "latest bun release" } },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "The latest Bun release is v1.4.3.",
          annotations: [
            { type: "url_citation", url: "https://bun.com/blog" },
            { type: "url_citation", url: "https://github.com/oven-sh/bun/releases" },
            { type: "url_citation", url: "https://bun.com/blog" },
          ],
        },
      ],
    },
  ],
};

describe("copilotWebSearch", () => {
  it("searches through Copilot's Responses API and returns the answer with its sources", async () => {
    const fetchImpl = fakeFetch(200, searchAnswer);

    const result = await copilotWebSearch(
      "latest bun release",
      { TAKODE_COPILOT_BASE_URL: "https://api.githubcopilot.com/", ANTHROPIC_AUTH_TOKEN: "test-key" },
      fetchImpl,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe(
      "The latest Bun release is v1.4.3.\n\nSources:\n- https://bun.com/blog\n- https://github.com/oven-sh/bun/releases",
    );
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.githubcopilot.com/responses");
    const headers = init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    // Copilot serves its newer models only to clients it recognizes.
    expect(headers["user-agent"]).toMatch(/^claude-cli\//);
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ model: "gpt-6-luna", tools: [{ type: "web_search" }] });
    expect(body.input).toContain("latest bun release");
  });

  it("gets the key from Claude's key helper command, and honors a model override", async () => {
    const fetchImpl = fakeFetch(200, searchAnswer);

    await copilotWebSearch(
      "anything",
      {
        PATH: process.env.PATH,
        TAKODE_COPILOT_BASE_URL: "https://api.githubcopilot.com",
        TAKODE_COPILOT_API_KEY_HELPER: "printf 'helper-key\\n'",
        TAKODE_COPILOT_WEB_SEARCH_MODEL: "gpt-5.4-mini",
        ANTHROPIC_AUTH_TOKEN: "unused-key",
      },
      fetchImpl,
    );

    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer helper-key");
    expect(JSON.parse(String(init.body)).model).toBe("gpt-5.4-mini");
  });

  it("reports Copilot's refusal and missing setup as tool errors instead of throwing", async () => {
    const refused = await copilotWebSearch(
      "anything",
      { TAKODE_COPILOT_BASE_URL: "https://api.githubcopilot.com", ANTHROPIC_API_KEY: "test-key" },
      fakeFetch(400, { error: { message: "The requested model is not supported." } }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("400");
    expect(refused.content[0]!.text).toContain("The requested model is not supported.");

    const noKey = await copilotWebSearch(
      "anything",
      { TAKODE_COPILOT_BASE_URL: "https://api.githubcopilot.com" },
      fakeFetch(200, {}),
    );
    expect(noKey).toMatchObject({ isError: true });
    expect(noKey.content[0]!.text).toContain("no GitHub Copilot key");

    const noAddress = await copilotWebSearch("anything", {}, fakeFetch(200, {}));
    expect(noAddress).toMatchObject({ isError: true });
  });
});
