import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestmasterTask } from "../server/quest-types.js";
import type { TodoCompactItem } from "../shared/todo-types.js";
import { fetchLinkedTodos, runShowCommand } from "./quest-show-command.js";

const quest = {
  questId: "q-7",
  version: 1,
  title: "Build the export",
  status: "in_progress",
  createdAt: 1,
  feedback: [],
} as unknown as QuestmasterTask;

const linkedTodo: TodoCompactItem = {
  id: "td-3",
  titleMarkdown: "Ship export",
  categoryId: "cat-inbox",
  categoryName: "Inbox",
  status: "todo",
  createdAt: 1,
  updatedAt: 1,
  statusChangedAt: 1,
};

async function showOutput(getLinkedTodos: Parameters<typeof runShowCommand>[0]["getLinkedTodos"]): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
  await runShowCommand({
    validateFlags: () => {},
    positional: () => "q-7",
    flag: () => false,
    option: () => undefined,
    getQuest: async () => quest,
    getSessionMetadataMap: async () => new Map(),
    getLinkedTodos,
    getSessionName: () => undefined,
    jsonOutput: false,
    out: () => {},
    die: (message) => {
      throw new Error(message);
    },
    printHumanFeedbackWarning: () => {},
  });
  vi.restoreAllMocks();
  return lines.join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quest show linked to-dos", () => {
  // An agent looking at a quest sees the personal to-dos that link it, with their status.
  it("lists linked to-dos after the quest detail", async () => {
    const output = await showOutput(async () => ({
      items: [linkedTodo, { ...linkedTodo, id: "td-4", status: "done" }],
    }));
    expect(output).toContain("Linked to-dos:\n  td-3 [todo] Ship export\n  td-4 [done] Ship export");
  });

  // No links prints nothing, and a to-do store error is reported instead of failing the quest read.
  it("stays quiet without links and reports an unavailable to-do list", async () => {
    expect(await showOutput(async () => ({ items: [] }))).not.toContain("Linked to-dos");
    expect(await showOutput(async () => null)).not.toContain("Linked to-dos");
    expect(await showOutput(async () => ({ error: "store is corrupt" }))).toContain(
      "Linked to-dos: unavailable (store is corrupt)",
    );
  });

  it("reads the reverse lookup and tells route errors from missing routes", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/todos/find?quest=q-7") {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ items: [linkedTodo] }));
      }
      if (req.url === "/api/todos/find?quest=q-8") {
        res.writeHead(503, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "store is corrupt" }));
      }
      res.writeHead(404).end("Not Found");
    });
    server.listen(0);
    await once(server, "listening");
    const port = String((server.address() as AddressInfo).port);
    try {
      expect(await fetchLinkedTodos(port, {}, "q-7")).toEqual({ items: [linkedTodo] });
      expect(await fetchLinkedTodos(port, {}, "q-8")).toEqual({ error: "store is corrupt" });
      expect(await fetchLinkedTodos(port, {}, "q-9")).toBeNull();
      expect(await fetchLinkedTodos(undefined, {}, "q-7")).toBeNull();
    } finally {
      server.close();
    }
  });
});
