import { describe, expect, it } from "vitest";
import { searchSessionDocuments, type SessionSearchDocument } from "./session-search.js";

describe("searchSessionDocuments", () => {
  it("ranks metadata matches above user-message matches", () => {
    const docs: SessionSearchDocument[] = [
      {
        sessionId: "s-name",
        archived: false,
        createdAt: 100,
        name: "Refactor auth middleware",
      },
      {
        sessionId: "s-message",
        archived: false,
        createdAt: 200,
        messageHistory: [{ type: "user_message", content: "Please refactor auth middleware flow", timestamp: 2000 }],
      },
    ];

    const out = searchSessionDocuments(docs, { query: "auth" });
    expect(out.totalMatches).toBe(2);
    expect(out.results[0]).toMatchObject({
      sessionId: "s-name",
      matchedField: "name",
    });
    expect(out.results[1]).toMatchObject({
      sessionId: "s-message",
      matchedField: "user_message",
    });
  });

  it("uses recency tie-breaker for same match category", () => {
    const docs: SessionSearchDocument[] = [
      {
        sessionId: "older",
        archived: false,
        createdAt: 10,
        lastActivityAt: 100,
        name: "Fix search ranking",
      },
      {
        sessionId: "newer",
        archived: false,
        createdAt: 10,
        lastActivityAt: 500,
        name: "Fix search ranking",
      },
    ];

    const out = searchSessionDocuments(docs, { query: "search" });
    expect(out.results.map((r) => r.sessionId)).toEqual(["newer", "older"]);
  });

  it("includes archived sessions by default and supports excluding them", () => {
    const docs: SessionSearchDocument[] = [
      {
        sessionId: "archived",
        archived: true,
        createdAt: 1,
        messageHistory: [{ type: "user_message", content: "needle in archive", timestamp: 1 }],
      },
      {
        sessionId: "active",
        archived: false,
        createdAt: 2,
        messageHistory: [{ type: "user_message", content: "needle in active", timestamp: 2 }],
      },
    ];

    const defaultOut = searchSessionDocuments(docs, { query: "needle" });
    expect(defaultOut.results.map((r) => r.sessionId)).toEqual(["active", "archived"]);

    const activeOnly = searchSessionDocuments(docs, {
      query: "needle",
      includeArchived: false,
    });
    expect(activeOnly.results.map((r) => r.sessionId)).toEqual(["active"]);
  });

  it("matches CamelCase tokens in session names", () => {
    // "plan mode" should match "ExitPlanMode" via CamelCase boundary splitting
    const docs: SessionSearchDocument[] = [
      {
        sessionId: "s-camel",
        archived: false,
        createdAt: 100,
        name: "ExitPlanMode feature",
      },
      {
        sessionId: "s-plain",
        archived: false,
        createdAt: 100,
        name: "exit plan mode feature",
      },
    ];

    const out = searchSessionDocuments(docs, { query: "plan mode" });
    expect(out.totalMatches).toBe(2);
    expect(out.results.map((r) => r.sessionId)).toContain("s-camel");
    expect(out.results.map((r) => r.sessionId)).toContain("s-plain");
  });

  it("matches CamelCase tokens in task titles", () => {
    const docs: SessionSearchDocument[] = [
      {
        sessionId: "s-task",
        archived: false,
        createdAt: 100,
        taskHistory: [{ title: "Implement BoardTable component", action: "new" as const, timestamp: 100, triggerMessageId: "m1" }],
      },
    ];

    const out = searchSessionDocuments(docs, { query: "board table" });
    expect(out.totalMatches).toBe(1);
  });
});
