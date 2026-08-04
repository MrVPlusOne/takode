import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSessionAuthDir, getSessionAuthPath } from "../shared/session-auth.js";

type JsonObject = Record<string, unknown>;

/** Compute centralized auth path — must match getSessionAuthPath() in cli-launcher.ts */
function centralAuthPath(cwd: string, home: string, serverId = "test-server-id"): string {
  return getSessionAuthPath(cwd, serverId, home);
}

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

async function runTakode(
  args: string[],
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
  stdin?: string,
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
  const child = spawn(process.execPath, [takodePath, ...args], {
    env,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (stdin !== undefined) {
    child.stdin?.end(stdin);
  } else {
    child.stdin?.end();
  }

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

describe("takode board set --worker auto-clears waitFor", () => {
  // When --worker is provided without --wait-for, the CLI should send waitFor: []
  // to clear stale dependencies from a previous board entry. When --wait-for is
  // also provided, the explicit value should take precedence.

  let server: ReturnType<typeof createServer>;
  let port: number;
  let capturedBodies: JsonObject[];
  let nextBoardResponse: JsonObject | null;
  let nextBoardError: { status: number; error: string } | null;

  beforeAll(async () => {
    capturedBodies = [];
    server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/api/takode/me") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "leader-1", isOrchestrator: true }));
        return;
      }
      // Capture the board set POST body and respond with a valid board
      if (req.method === "POST" && req.url?.startsWith("/api/sessions/leader-1/board")) {
        const body = await readJson(req);
        capturedBodies.push(body);
        if (nextBoardError) {
          res.writeHead(nextBoardError.status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: nextBoardError.error }));
          return;
        }
        const questId = typeof body.questId === "string" ? body.questId : "q-1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            board: [{ questId, status: body.status ?? "PLANNING" }],
            ...(nextBoardResponse ?? {}),
          }),
        );
        return;
      }
      // Worker info lookup -- return a resolved session
      if (req.method === "GET" && req.url?.includes("/sessions/") && req.url?.endsWith("/info")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: "worker-session-abc", sessionNum: 3 }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0);
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    capturedBodies = [];
    nextBoardResponse = null;
    nextBoardError = null;
  });

  it("sends waitFor: [] when --worker is provided without --wait-for", async () => {
    const result = await runTakode(["board", "set", "q-1", "--worker", "3", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(0);
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].waitFor).toEqual([]);
  });

  it("preserves explicit --wait-for when provided alongside --worker", async () => {
    const result = await runTakode(
      ["board", "set", "q-1", "--worker", "3", "--wait-for", "q-2,q-3", "--port", String(port)],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].waitFor).toEqual(["q-2", "q-3"]);
  });

  it("does not send waitFor when --worker is not provided", async () => {
    const result = await runTakode(["board", "set", "q-1", "--status", "PLANNING", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(0);
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].waitFor).toBeUndefined();
  });

  it("handles --wait-for with empty string by sending empty array (not [''])", async () => {
    // Guards against naive .split(",") producing [""] instead of []
    const result = await runTakode(["board", "set", "q-1", "--wait-for", "", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(0);
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].waitFor).toEqual([]);
  });

  it("rejects removed --no-code flag", async () => {
    const result = await runTakode(["board", "set", "q-1", "--no-code", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Board no-code flags were removed");
    expect(result.stderr).toContain("Alignment -> Work -> Memory");
    expect(capturedBodies).toHaveLength(0);
  });

  it("rejects removed --code-change flag", async () => {
    const result = await runTakode(["board", "set", "q-1", "--code-change", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Board no-code flags were removed");
    expect(result.stderr).toContain("Alignment -> Work -> Memory");
    expect(capturedBodies).toHaveLength(0);
  });

  it("sends planned Quest Journey phases and preset metadata", async () => {
    const result = await runTakode(
      [
        "board",
        "set",
        "q-1",
        "--worker",
        "3",
        "--phases",
        "alignment,work,memory",
        "--preset",
        "v2-work",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].worker).toBe("worker-session-abc");
    expect(capturedBodies[0].workerNum).toBe(3);
    expect(capturedBodies[0].phases).toEqual(["alignment", "work", "memory"]);
    expect(capturedBodies[0].presetId).toBe("v2-work");
  });

  it("posts proposed Journey rows with explicit proposal mode and approval hold", async () => {
    nextBoardResponse = {
      proposalReview: {
        questId: "q-1",
        title: "Draft proposal workflow",
        status: "PROPOSED",
        presentedAt: 123,
        summary: "Approve the proposal goal, tradeoff, and scheduling.",
        journey: {
          mode: "proposed",
          phaseIds: ["alignment", "work", "memory"],
        },
      },
    };

    const result = await runTakode(
      [
        "board",
        "propose",
        "q-1",
        "--phases",
        "alignment,work,memory",
        "--preset",
        "v2-work",
        "--summary",
        "Approve the proposal goal, tradeoff, and scheduling.",
        "--wait-for-input",
        "3",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      questId: "q-1",
      journeyMode: "proposed",
      status: "PROPOSED",
      phases: ["alignment", "work", "memory"],
      presetId: "v2-work",
      waitForInput: ["n-3"],
      presentation: {
        summary: "Approve the proposal goal, tradeoff, and scheduling.",
      },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      __takode_board__: true,
      operation: "propose q-1: updated",
      proposalReview: {
        questId: "q-1",
        summary: "Approve the proposal goal, tradeoff, and scheduling.",
      },
    });
  });

  it("rejects proposed Journey rows without the mandatory approval summary before posting", async () => {
    // The summary is the user-facing approval packet; fail client-side so leaders cannot create a
    // proposal UI that only shows the Journey without the non-Journey approval context.
    const result = await runTakode(
      ["board", "propose", "q-1", "--phases", "alignment,implement,code-review,port,memory", "--port", String(port)],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("takode board propose requires --summary");
    expect(capturedBodies).toHaveLength(0);
  });

  it("rejects adjacent Explore to Implement before posting board phases", async () => {
    const result = await runTakode(
      ["board", "set", "q-1", "--phases", "alignment,explore,implement,code-review", "--port", String(port)],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid Quest Journey phase(s)");
    expect(capturedBodies).toHaveLength(0);
  });

  it("posts proposed Journey files as one batch phase and note update", async () => {
    const dir = mkdtempSync(join(tmpdir(), "takode-board-spec-"));
    const specPath = join(dir, "proposal.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        title: "Draft proposal workflow",
        presetId: "v2-work",
        phases: [
          { id: "alignment" },
          { id: "work", note: "Classify the noisy log source during Work." },
          { id: "user-checkpoint", note: "Present classification options before Work resumes." },
          { id: "memory", note: "" },
        ],
        presentation: {
          summary: "Proposed Journey for approval",
          scheduling: { intent: "dispatch-after-approval" },
        },
      }),
    );

    const result = await runTakode(
      [
        "board",
        "propose",
        "q-1",
        "--journey-file",
        specPath,
        "--summary",
        "Approve the proposed goal and scheduling.",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      questId: "q-1",
      title: "Draft proposal workflow",
      journeyMode: "proposed",
      status: "PROPOSED",
      phases: ["alignment", "work", "user-checkpoint", "memory"],
      presetId: "v2-work",
      phaseNoteEdits: [
        { index: 0, note: null },
        { index: 1, note: "Classify the noisy log source during Work." },
        { index: 2, note: "Present classification options before Work resumes." },
        { index: 3, note: null },
      ],
      presentation: {
        summary: "Approve the proposed goal and scheduling.",
        scheduling: { intent: "dispatch-after-approval" },
      },
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects optional User Checkpoint spec notes without concrete skip conditions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "takode-board-spec-"));
    const specPath = join(dir, "proposal.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        phases: [
          { id: "alignment" },
          { id: "work" },
          { id: "user-checkpoint", note: "Optional checkpoint." },
          { id: "memory" },
        ],
      }),
    );

    const result = await runTakode(
      [
        "board",
        "propose",
        "q-1",
        "--journey-file",
        specPath,
        "--summary",
        "Approve this optional checkpoint proposal.",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Optional User Checkpoints require");
    expect(capturedBodies).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("posts an explicit optional User Checkpoint skip reason when advancing", async () => {
    const result = await runTakode(
      [
        "board",
        "advance",
        "q-1",
        "--skip-optional-checkpoint",
        "Explore found no user-facing tradeoff.",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toEqual({
      skipOptionalUserCheckpointReason: "Explore found no user-facing tradeoff.",
    });
  });

  it("rejects optional User Checkpoint skip attempts without a reason", async () => {
    const result = await runTakode(["board", "advance", "q-1", "--skip-optional-checkpoint", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--skip-optional-checkpoint requires a reason");
    expect(capturedBodies).toHaveLength(0);
  });

  it("rejects board present with propose migration guidance", async () => {
    const result = await runTakode(["board", "present", "q-1", "--summary", "old path", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("takode board present was removed");
    expect(result.stderr).toContain("takode board propose");
    expect(capturedBodies).toHaveLength(0);
  });

  it("promotes proposed rows into active mode and clears approval hold by default", async () => {
    const result = await runTakode(["board", "promote", "q-1", "--worker", "3", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      questId: "q-1",
      journeyMode: "active",
      worker: "worker-session-abc",
      workerNum: 3,
      clearWaitForInput: true,
    });
    expect(capturedBodies[0].phases).toBeUndefined();
  });

  it("sends explicit force-promote override only when requested", async () => {
    const result = await runTakode(["board", "promote", "q-1", "--force-promote-unpresented", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      questId: "q-1",
      journeyMode: "active",
      forcePromoteUnpresented: true,
      clearWaitForInput: true,
    });
  });

  it("sends board note edits keyed by 1-based phase positions", async () => {
    nextBoardResponse = {
      board: [
        {
          questId: "q-1",
          status: "CODE_REVIEWING",
          createdAt: 1,
          updatedAt: 2,
          journey: {
            mode: "active",
            phaseIds: ["alignment", "explore", "implement", "code-review", "port"],
            activePhaseIndex: 3,
            currentPhaseId: "code-review",
            phaseNotes: { "3": "Inspect only the follow-up diff" },
          },
        },
      ],
    };
    const result = await runTakode(
      ["board", "note", "q-1", "4", "--text", "Inspect only the follow-up diff", "--port", String(port)],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      questId: "q-1",
      phaseNoteEdits: [{ index: 3, note: "Inspect only the follow-up diff" }],
    });
  });

  it("surfaces server rejection of a new future Explore to Implement suffix", async () => {
    // The CLI cannot infer persisted history, so the server remains authoritative for suffix rejection text.
    nextBoardError = {
      status: 400,
      error: "Server-side v2 revision rejection",
    };

    const result = await runTakode(
      [
        "board",
        "revise",
        "q-1",
        "--from-position",
        "5",
        "--expect-phase",
        "memory",
        "--phases",
        "work,memory",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Server-side v2 revision rejection");
    expect(capturedBodies[0]).toMatchObject({
      fromIndex: 4,
      expectedPhaseId: "memory",
      phases: ["work", "memory"],
    });
  });

  it("sends explicit active phase positions as zero-based activePhaseIndex", async () => {
    nextBoardResponse = {
      board: [
        {
          questId: "q-1",
          status: "USER_CHECKPOINTING",
          createdAt: 1,
          updatedAt: 2,
          journey: {
            phaseIds: ["alignment", "work", "user-checkpoint", "work", "user-checkpoint", "work", "memory"],
            activePhaseIndex: 4,
            currentPhaseId: "user-checkpoint",
          },
        },
      ],
    };

    const result = await runTakode(
      [
        "board",
        "set",
        "q-1",
        "--status",
        "USER_CHECKPOINTING",
        "--active-phase-position",
        "5",
        "--phases",
        "alignment,work,user-checkpoint,work,user-checkpoint,work,memory",
        "--full",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      questId: "q-1",
      status: "USER_CHECKPOINTING",
      activePhaseIndex: 4,
      phases: ["alignment", "work", "user-checkpoint", "work", "user-checkpoint", "work", "memory"],
    });
    expect(result.stdout).toContain(
      "journey: 1. Alignment -> 2. Work -> 3. User Checkpoint -> 4. Work -> [5. User Checkpoint] -> 6. Work -> 7. Memory",
    );
  });

  it("prints explicit warnings when a Journey revision drops rebased notes", async () => {
    nextBoardResponse = {
      phaseNoteRebaseWarnings: [
        {
          previousIndex: 4,
          previousPhaseId: "user-checkpoint",
          previousOccurrence: 1,
          note: "Replay turns 116/120/121/122-123 before dispatching this phase",
        },
      ],
    };

    const result = await runTakode(
      [
        "board",
        "revise",
        "q-1",
        "--from-position",
        "5",
        "--expect-phase",
        "user-checkpoint",
        "--phases",
        "memory",
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      fromIndex: 4,
      expectedPhaseId: "user-checkpoint",
      phases: ["memory"],
    });
    expect(result.stdout).toContain("User Checkpoint occurrence 1 was dropped during revision");
    expect(result.stdout).toContain("Replay turns 116/120/121/122-123 before dispatching this phase");
  });

  it.each([
    ["--dry-run", "--dry-run is not supported"],
    ["--reason", "Journey revision reasons are no longer required"],
    ["--revise-reason", "Journey revision reasons are no longer required"],
  ])("rejects board revise %s before posting", async (flag, expectedError) => {
    const result = await runTakode(
      [
        "board",
        "revise",
        "q-1",
        "--from-position",
        "5",
        "--expect-phase",
        "memory",
        "--phases",
        "user-checkpoint,memory",
        flag,
        flag === "--dry-run" ? "--port" : "old reason",
        ...(flag === "--dry-run" ? [String(port)] : ["--port", String(port)]),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
    expect(capturedBodies).toHaveLength(0);
  });

  it("posts board revise journey files as replacement suffix phase-note edits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "takode-board-revise-file-"));
    const journeyPath = join(dir, "suffix.json");
    writeFileSync(
      journeyPath,
      JSON.stringify({
        presetId: "checkpoint-before-memory",
        phases: [{ id: "user-checkpoint", note: "Approve the recommended design before Memory." }, { id: "memory" }],
      }),
    );

    const result = await runTakode(
      [
        "board",
        "revise",
        "q-1",
        "--from-position",
        "5",
        "--expect-phase",
        "memory",
        "--journey-file",
        journeyPath,
        "--port",
        String(port),
      ],
      {
        ...process.env,
        COMPANION_SESSION_ID: "leader-1",
        COMPANION_AUTH_TOKEN: "auth-1",
      },
    );

    expect(result.status).toBe(0);
    expect(capturedBodies[0]).toMatchObject({
      fromIndex: 4,
      expectedPhaseId: "memory",
      phases: ["user-checkpoint", "memory"],
      presetId: "checkpoint-before-memory",
      phaseNoteEdits: [
        { index: 0, note: "Approve the recommended design before Memory." },
        { index: 1, note: null },
      ],
    });
  });

  it("rejects unknown planned Quest Journey phase IDs before posting", async () => {
    const result = await runTakode(["board", "set", "q-1", "--phases", "planning,unknown", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid Quest Journey phase");
    expect(capturedBodies).toHaveLength(0);
  });

  it("requires --phases when setting a Quest Journey preset", async () => {
    const result = await runTakode(["board", "set", "q-1", "--preset", "lightweight-code", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use --preset only with --phases");
    expect(capturedBodies).toHaveLength(0);
  });

  it("rejects removed no-code flags even when both are supplied", async () => {
    const result = await runTakode(["board", "set", "q-1", "--no-code", "--code-change", "--port", String(port)], {
      ...process.env,
      COMPANION_SESSION_ID: "leader-1",
      COMPANION_AUTH_TOKEN: "auth-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Board no-code flags were removed");
    expect(result.stderr).toContain("Alignment -> Work -> Memory");
  });
});
