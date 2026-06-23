import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

function readJson(req: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      resolve(body ? (JSON.parse(body) as JsonObject) : {});
    });
  });
}

async function runQuest(args: string[], env: Record<string, string | undefined>, cwd: string) {
  const questPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  const child = spawn(process.execPath, [questPath, ...args], {
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR:
        env.BUN_INSTALL_CACHE_DIR ||
        process.env.BUN_INSTALL_CACHE_DIR ||
        join(process.env.HOME || "", ".bun/install/cache"),
    },
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const [code] = await once(child, "close");
  return { status: code as number | null, stdout, stderr };
}

describe("quest quiz CLI", () => {
  it("writes normalized quiz metadata through the Companion quiz endpoint", async () => {
    // Confirms agents can attach active-recall Q/A via the dedicated command path.
    const tmp = mkdtempSync(join(tmpdir(), "quest-cli-quiz-"));
    const itemsPath = join(tmp, "quiz.json");
    writeFileSync(
      itemsPath,
      JSON.stringify({
        quizItems: [
          {
            question: "  What should the user recall?  ",
            answer: "  The important decision.  ",
            source: "  Memory  ",
          },
        ],
      }),
      "utf-8",
    );

    const seenBodies: JsonObject[] = [];
    const server = createServer(async (req, res) => {
      if (req.method === "PUT" && req.url === "/api/quests/q-7/quiz") {
        const body = await readJson(req);
        seenBodies.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "q-7-v1",
            questId: "q-7",
            version: 1,
            title: "Quiz quest",
            status: "idea",
            createdAt: 1,
            quizItems: body.quizItems,
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = String((server.address() as AddressInfo).port);
      const result = await runQuest(
        ["quiz", "set", "q-7", "--items-file", itemsPath],
        {
          ...process.env,
          COMPANION_PORT: port,
          COMPANION_SESSION_ID: undefined,
          COMPANION_AUTH_TOKEN: undefined,
          HOME: tmp,
        },
        tmp,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Updated quiz for q-7 (1 item(s))");
      expect(seenBodies).toEqual([
        {
          quizItems: [
            {
              id: "quiz-1",
              question: "What should the user recall?",
              answer: "The important decision.",
              source: "Memory",
            },
          ],
        },
      ]);
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
