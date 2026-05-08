import { describe, it, expect } from "vitest";
import {
  expandCamelCase,
  normalizeForSearch,
  multiWordMatch,
  rankSearchFields,
  tokenizeForSearch,
} from "./search-utils.js";

describe("expandCamelCase", () => {
  it("splits basic CamelCase", () => {
    expect(expandCamelCase("ExitPlanMode")).toBe("Exit Plan Mode");
    expect(expandCamelCase("camelCase")).toBe("camel Case");
    expect(expandCamelCase("BoardTable")).toBe("Board Table");
  });

  it("handles consecutive uppercase (acronyms)", () => {
    expect(expandCamelCase("HTMLParser")).toBe("HTML Parser");
    expect(expandCamelCase("getHTTPResponse")).toBe("get HTTP Response");
    expect(expandCamelCase("XMLHTTPRequest")).toBe("XMLHTTP Request");
  });

  it("preserves already-spaced text", () => {
    expect(expandCamelCase("already spaced")).toBe("already spaced");
    expect(expandCamelCase("hello world")).toBe("hello world");
  });

  it("handles single words", () => {
    expect(expandCamelCase("hello")).toBe("hello");
    expect(expandCamelCase("Hello")).toBe("Hello");
    expect(expandCamelCase("HTTP")).toBe("HTTP");
  });

  it("handles empty and whitespace", () => {
    expect(expandCamelCase("")).toBe("");
    expect(expandCamelCase("  ")).toBe("  ");
  });

  it("handles mixed CamelCase with numbers", () => {
    expect(expandCamelCase("session123Start")).toBe("session123 Start");
    expect(expandCamelCase("getV2API")).toBe("get V2 API");
  });

  it("handles snake_case and kebab-case (no change)", () => {
    expect(expandCamelCase("snake_case_name")).toBe("snake_case_name");
    expect(expandCamelCase("kebab-case-name")).toBe("kebab-case-name");
  });

  it("handles paths with CamelCase segments", () => {
    expect(expandCamelCase("QuestmasterPage.tsx")).toBe("Questmaster Page.tsx");
    expect(expandCamelCase("src/components/BoardTable")).toBe("src/components/Board Table");
  });
});

describe("normalizeForSearch", () => {
  it("expands CamelCase and lowercases", () => {
    expect(normalizeForSearch("ExitPlanMode")).toBe("exit plan mode");
    expect(normalizeForSearch("HTMLParser")).toBe("html parser");
  });

  it("splits divided words", () => {
    expect(normalizeForSearch("memory-ui_setting")).toBe("memory ui setting");
  });

  it("preserves non-ASCII letters and numbers as searchable tokens", () => {
    expect(normalizeForSearch("修复 记忆 搜索 café")).toBe("修复 记忆 搜索 café");
  });

  it("trims whitespace", () => {
    expect(normalizeForSearch("  hello  ")).toBe("hello");
  });

  it("handles plain lowercase text", () => {
    expect(normalizeForSearch("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(normalizeForSearch("")).toBe("");
  });

  it("normalizes punctuation-only text to empty", () => {
    expect(normalizeForSearch("!!! -- ___")).toBe("");
  });
});

describe("multiWordMatch", () => {
  it("matches a single word", () => {
    expect(multiWordMatch("Run dev-server E2E sanity", "run")).toBe(true);
  });

  it("matches multiple non-consecutive words", () => {
    // The core use case: "run dev" should match even though the words aren't adjacent
    expect(multiWordMatch("Run current-main dev-server E2E sanity before prod restart", "run dev")).toBe(true);
  });

  it("matches regardless of word order in query", () => {
    expect(multiWordMatch("Run current-main dev-server", "dev run")).toBe(true);
  });

  it("returns false when not all words match", () => {
    expect(multiWordMatch("Run current-main dev-server", "run banana")).toBe(false);
  });

  it("returns false for empty query", () => {
    expect(multiWordMatch("some text", "")).toBe(false);
    expect(multiWordMatch("some text", "   ")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(multiWordMatch("Design a Production Logging System", "production logging")).toBe(true);
  });

  it("handles CamelCase expansion", () => {
    // "plan mode" should match "ExitPlanMode" via CamelCase expansion
    expect(multiWordMatch("ExitPlanMode", "plan mode")).toBe(true);
  });

  it("matches word prefixes but not arbitrary mid-word substrings", () => {
    expect(multiWordMatch("Questmaster user interface polish", "inter pol")).toBe(true);
    expect(multiWordMatch("Remove remaining memory recall guidance", "memory ui")).toBe(false);
    expect(multiWordMatch("Use required renameable server slugs", "ui")).toBe(false);
  });

  it("matches camelCase, PascalCase, and divided word tokens", () => {
    expect(multiWordMatch("renderSearchHighlightText", "search high")).toBe(true);
    expect(multiWordMatch("QuestmasterSearchPanel", "quest search")).toBe(true);
    expect(multiWordMatch("memory-ui_setting", "memory ui setting")).toBe(true);
  });

  it("matches non-ASCII exact words and prefixes", () => {
    expect(multiWordMatch("修复 记忆 搜索", "记忆")).toBe(true);
    expect(multiWordMatch("修复 记忆 搜索", "搜")).toBe(true);
  });
});

describe("tokenizeForSearch", () => {
  it("returns searchable word tokens for divided and CamelCase input", () => {
    expect(tokenizeForSearch("abc-def_ghi ExitPlanMode")).toEqual(["abc", "def", "ghi", "exit", "plan", "mode"]);
  });

  it("returns Unicode tokens instead of dropping non-ASCII text", () => {
    expect(tokenizeForSearch("修复-记忆_search")).toEqual(["修复", "记忆", "search"]);
  });
});

describe("rankSearchFields", () => {
  it("prefers exact word matches over word-prefix matches", () => {
    const exact = rankSearchFields([{ rank: 4, text: "build ui controls" }], "ui");
    const prefix = rankSearchFields([{ rank: 1, text: "build uikit controls" }], "ui");
    expect(exact).not.toBeNull();
    expect(prefix).not.toBeNull();
    expect(exact![0]).toBeLessThan(prefix![0]);
  });
});
