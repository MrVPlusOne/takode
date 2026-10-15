import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";
import type { BrowserIncomingMessage } from "./session-types.js";

let tempDir: string;
let store: SessionStore;

function makeSession(id: string, overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    id,
    state: {
      session_id: id,
      model: "claude-sonnet-4-5-20250929",
      cwd: "/test",
      tools: [],
      permissionMode: "default",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      agents: [],
      slash_commands: [],
      skills: [],
      total_cost_usd: 0,
      num_turns: 0,
      context_used_percent: 0,
      is_compacting: false,
      git_branch: "",
      is_worktree: false,
      is_containerized: false,
      repo_root: "",
      git_ahead: 0,
      git_behind: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    },
    messageHistory: [],
    pendingMessages: [],
    pendingPermissions: [],
    ...overrides,
  };
}

/** Helper: build a minimal completed turn (user → assistant → result). */
function makeTurnMessages(turnIndex: number): PersistedSession["messageHistory"] {
  return [
    { type: "user_message", content: `Turn ${turnIndex} question`, timestamp: Date.now() + turnIndex * 1000 },
    {
      type: "assistant",
      message: {
        id: `msg-${turnIndex}`,
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: [
          { type: "text", text: `Turn ${turnIndex} answer` },
          { type: "tool_use", id: `tu-${turnIndex}`, name: "Read", input: {} },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: Date.now() + turnIndex * 1000 + 500,
      turn_duration_ms: 1200,
    },
    {
      type: "result",
      data: { type: "result", subtype: "success", uuid: `result-${turnIndex}` },
    },
  ] as PersistedSession["messageHistory"];
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ss-test-"));
  store = new SessionStore(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Property-based tests for frozen history correctness ─────────────────────
//
// These tests use a seeded PRNG to generate random message sequences and verify
// structural invariants of the two-tier persistence system. Each test runs many
// iterations with different random inputs to stress edge cases that hand-written
// tests might miss.

describe("property-based: frozen history correctness", () => {
  const PROPERTY_TEST_TIMEOUT_MS = 30_000;

  // ── Seeded PRNG (Mulberry32) ────────────────────────────────────────────
  // Deterministic 32-bit PRNG so test failures are reproducible. Pass any
  // integer seed. Returns a function producing numbers in [0, 1).
  function mulberry32(seed: number): () => number {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Random message generators ──────────────────────────────────────────
  // Message types that appear in real sessions. The key property is that
  // "result" marks the freeze boundary — everything up to the last result
  // is frozen, and everything after stays hot.

  type MsgType = "user_message" | "assistant" | "assistant_with_tool" | "stream_event" | "result" | "error";
  const MSG_TYPES: MsgType[] = ["user_message", "assistant", "assistant_with_tool", "stream_event", "result", "error"];

  /** Build a single message of the given type. Includes a unique marker so
   *  we can verify ordering and identity after round-trip. */
  function makeMsg(type: MsgType, index: number): PersistedSession["messageHistory"][number] {
    switch (type) {
      case "user_message":
        return {
          type: "user_message",
          content: `user-${index}`,
          timestamp: 1000 + index,
        } as PersistedSession["messageHistory"][number];
      case "assistant":
        return {
          type: "assistant",
          message: {
            id: `msg-${index}`,
            role: "assistant",
            model: "claude-sonnet-4-5-20250929",
            content: [{ type: "text", text: `asst-${index}` }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
          parent_tool_use_id: null,
          timestamp: 1000 + index,
        } as PersistedSession["messageHistory"][number];
      case "assistant_with_tool":
        return {
          type: "assistant",
          message: {
            id: `msg-${index}`,
            role: "assistant",
            model: "claude-sonnet-4-5-20250929",
            content: [
              { type: "text", text: `asst-tool-${index}` },
              { type: "tool_use", id: `tu-${index}`, name: "Read", input: {} },
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
          parent_tool_use_id: null,
          timestamp: 1000 + index,
        } as PersistedSession["messageHistory"][number];
      case "stream_event":
        return {
          type: "stream_event",
          event: { content: `stream-${index}` },
          parent_tool_use_id: null,
        } as PersistedSession["messageHistory"][number];
      case "result":
        return {
          type: "result",
          data: { type: "result", subtype: "success", uuid: `result-${index}` },
        } as PersistedSession["messageHistory"][number];
      case "error":
        return {
          type: "error",
          message: `error-${index}`,
        } as PersistedSession["messageHistory"][number];
    }
  }

  /** Generate a random message sequence of `count` messages.
   *  Ensures at least some structural realism: user messages precede
   *  assistants, and result messages only appear after at least one
   *  non-result message (to avoid empty turns). */
  function randomMessageSequence(rng: () => number, count: number): PersistedSession["messageHistory"] {
    const msgs: PersistedSession["messageHistory"] = [];
    for (let i = 0; i < count; i++) {
      const typeIdx = Math.floor(rng() * MSG_TYPES.length);
      msgs.push(makeMsg(MSG_TYPES[typeIdx], i));
    }
    return msgs;
  }

  /** Generate tool results corresponding to assistant_with_tool messages. */
  function toolResultsForMessages(
    msgs: PersistedSession["messageHistory"],
  ): NonNullable<PersistedSession["toolResults"]> {
    const results: NonNullable<PersistedSession["toolResults"]> = [];
    for (const msg of msgs) {
      if ((msg as { type: string }).type !== "assistant") continue;
      const content = (msg as { message?: { content?: Array<{ type: string; id?: string }> } }).message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === "tool_use" && block.id) {
          results.push([block.id, { content: `result-for-${block.id}`, is_error: false, timestamp: Date.now() }]);
        }
      }
    }
    return results;
  }

  /** Compute the expected freeze cutoff: index after the last "result" message. */
  function expectedFreezeCutoff(msgs: PersistedSession["messageHistory"]): number {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if ((msgs[i] as { type: string }).type === "result") return i + 1;
    }
    return 0;
  }

  /** Generate a realistic multi-turn message sequence:
   *  N completed turns (user → assistant_with_tool → result) + optional
   *  in-progress tail (user → assistant, no result). This mirrors real
   *  session patterns more closely than fully random sequences. */
  function realisticSequence(
    rng: () => number,
    completedTurns: number,
    inProgressMessages: number,
  ): { messages: PersistedSession["messageHistory"]; toolResults: NonNullable<PersistedSession["toolResults"]> } {
    const msgs: PersistedSession["messageHistory"] = [];
    const toolResults: NonNullable<PersistedSession["toolResults"]> = [];
    let idx = 0;

    for (let t = 0; t < completedTurns; t++) {
      // User message
      msgs.push(makeMsg("user_message", idx++));
      // 1-3 assistant messages (some with tools)
      const assistantCount = 1 + Math.floor(rng() * 3);
      for (let a = 0; a < assistantCount; a++) {
        const hasTools = rng() > 0.4;
        if (hasTools) {
          msgs.push(makeMsg("assistant_with_tool", idx));
          toolResults.push([`tu-${idx}`, { content: `result-${idx}`, is_error: rng() > 0.9, timestamp: 1000 + idx }]);
        } else {
          msgs.push(makeMsg("assistant", idx));
        }
        idx++;
      }
      // Optional stream events
      const streamCount = Math.floor(rng() * 3);
      for (let s = 0; s < streamCount; s++) {
        msgs.push(makeMsg("stream_event", idx++));
      }
      // Result
      msgs.push(makeMsg("result", idx++));
    }

    // In-progress tail (no result)
    for (let i = 0; i < inProgressMessages; i++) {
      const type = rng() > 0.5 ? "user_message" : rng() > 0.5 ? "assistant" : "stream_event";
      msgs.push(makeMsg(type as MsgType, idx++));
    }

    return { messages: msgs, toolResults };
  }

  const ITERATIONS = 80;

  function seedRanges(total: number, size: number): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 1; start <= total; start += size) {
      ranges.push({ start, end: Math.min(total, start + size - 1) });
    }
    return ranges;
  }

  // ── P1: Round-trip correctness ──────────────────────────────────────────
  // For ANY sequence of messages, save() → load() must reconstruct the
  // exact same messageHistory and toolResults.
  describe("P1: round-trip correctness — random message sequences", () => {
    let p1TempDir: string;
    const cases = new Map<
      number,
      {
        sessionId: string;
        messages: PersistedSession["messageHistory"];
        toolResults: NonNullable<PersistedSession["toolResults"]>;
        loaded?: PersistedSession | null;
      }
    >();

    beforeAll(async () => {
      p1TempDir = mkdtempSync(join(tmpdir(), "ss-p1-test-"));
      const p1Store = new SessionStore(p1TempDir);

      for (let seed = 1; seed <= ITERATIONS; seed++) {
        const rng = mulberry32(seed);
        const msgCount = Math.floor(rng() * 30);
        const messages = randomMessageSequence(rng, msgCount);
        const toolResults = toolResultsForMessages(messages);

        const sessionId = `p1-${seed}`;
        const session = makeSession(sessionId, {
          messageHistory: [...messages],
          toolResults: [...toolResults],
        });

        p1Store.saveSync(session);
        cases.set(seed, { sessionId, messages, toolResults });
      }
      await p1Store.flushAll();

      await Promise.all(
        [...cases.values()].map(async (testCase) => {
          testCase.loaded = await new SessionStore(p1TempDir).load(testCase.sessionId);
        }),
      );
    }, PROPERTY_TEST_TIMEOUT_MS);

    afterAll(() => {
      if (p1TempDir) rmSync(p1TempDir, { recursive: true, force: true });
    });

    for (let seed = 1; seed <= ITERATIONS; seed++) {
      it(`seed ${seed}`, async () => {
        const testCase = cases.get(seed);
        expect(testCase, `seed=${seed}: missing prepared round-trip fixture`).toBeDefined();

        const { loaded, messages, toolResults } = testCase!;
        expect(loaded, `seed=${seed}: load() returned null`).not.toBeNull();
        expect(loaded!.messageHistory).toHaveLength(messages.length);

        // Deep equality on each message to catch serialization drift.
        for (let i = 0; i < messages.length; i++) {
          expect(loaded!.messageHistory[i], `seed=${seed}: msg[${i}] mismatch`).toEqual(messages[i]);
        }

        // Tool results must round-trip exactly.
        expect(loaded!.toolResults ?? [], `seed=${seed}: toolResults length`).toHaveLength(toolResults.length);
        for (let i = 0; i < toolResults.length; i++) {
          expect(loaded!.toolResults![i][0], `seed=${seed}: toolResult[${i}] key`).toBe(toolResults[i][0]);
          expect(loaded!.toolResults![i][1].content, `seed=${seed}: toolResult[${i}] content`).toBe(
            toolResults[i][1].content,
          );
        }
      });
    }
  });

  // ── P2: Incremental freeze is append-only ───────────────────────────────
  // After each save, the JSONL content from the previous save must be a
  // prefix of the current content (existing lines are never modified).
  for (const { start, end } of seedRanges(ITERATIONS, 5)) {
    describe(`P2: JSONL is append-only — content from previous save is a prefix (seeds ${start}-${end})`, () => {
      let p2TempDir: string;
      const cases = new Map<
        number,
        {
          sessionId: string;
          turns: Array<ReturnType<typeof realisticSequence>>;
          allMessages: PersistedSession["messageHistory"];
          allToolResults: NonNullable<PersistedSession["toolResults"]>;
          prevLogContent: string;
          observations: Array<{ turn: number; previousLog: string; currentLog: string; logPath: string }>;
        }
      >();

      beforeAll(async () => {
        p2TempDir = mkdtempSync(join(tmpdir(), "ss-p2-test-"));
        const p2Store = new SessionStore(p2TempDir);

        for (let seed = start; seed <= end; seed++) {
          const rng = mulberry32(seed + 10000);
          const sessionId = `p2-${seed}`;
          const totalTurns = 1 + Math.floor(rng() * 5);
          const turns: Array<ReturnType<typeof realisticSequence>> = [];

          for (let t = 0; t < totalTurns; t++) {
            turns.push(realisticSequence(rng, 1, 0));
          }

          cases.set(seed, {
            sessionId,
            turns,
            allMessages: [],
            allToolResults: [],
            prevLogContent: "",
            observations: [],
          });
        }

        const maxTurns = Math.max(...[...cases.values()].map(({ turns }) => turns.length));
        for (let t = 0; t < maxTurns; t++) {
          const changedCases: Array<NonNullable<ReturnType<typeof cases.get>>> = [];
          for (const testCase of cases.values()) {
            const turn = testCase.turns[t];
            if (!turn) continue;

            testCase.allMessages = [...testCase.allMessages, ...turn.messages];
            testCase.allToolResults = [...testCase.allToolResults, ...turn.toolResults];
            p2Store.saveSync(
              makeSession(testCase.sessionId, {
                messageHistory: [...testCase.allMessages],
                toolResults: [...testCase.allToolResults],
              }),
            );
            changedCases.push(testCase);
          }

          await p2Store.flushAll();

          await Promise.all(
            changedCases.map(async (testCase) => {
              const logPath = join(p2TempDir, `${testCase.sessionId}.history.jsonl`);
              if (!existsSync(logPath)) return;
              const currentLog = await readFile(logPath, "utf-8");
              if (testCase.prevLogContent) {
                testCase.observations.push({
                  turn: t,
                  previousLog: testCase.prevLogContent,
                  currentLog,
                  logPath,
                });
              }
              testCase.prevLogContent = currentLog;
            }),
          );
        }
      }, PROPERTY_TEST_TIMEOUT_MS);

      afterAll(() => {
        if (p2TempDir) rmSync(p2TempDir, { recursive: true, force: true });
      });

      for (let seed = start; seed <= end; seed++) {
        it(`seed ${seed}`, () => {
          const testCase = cases.get(seed);
          expect(testCase, `seed=${seed}: missing prepared append-only fixture`).toBeDefined();

          for (const observation of testCase!.observations) {
            expect(
              observation.currentLog.startsWith(observation.previousLog),
              `seed=${seed}, turn=${observation.turn}: JSONL is not append-only — previous content not a prefix (${observation.logPath})`,
            ).toBe(true);
          }
        });
      }
    });
  }

  // ── P4: Tool results are never lost ─────────────────────────────────────
  // For any sequence of saves, all tool results present in the input must
  // be present in the loaded output.
  for (let seed = 1; seed <= ITERATIONS; seed++) {
    it(
      `P4: tool results are never lost across save/load (seed ${seed})`,
      async () => {
        const rng = mulberry32(seed + 30000);
        const sessionId = `p4-${seed}`;
        const totalTurns = 1 + Math.floor(rng() * 5);
        let allMessages: PersistedSession["messageHistory"] = [];
        let allToolResults: NonNullable<PersistedSession["toolResults"]> = [];

        // Build up incrementally — save after each turn.
        for (let t = 0; t < totalTurns; t++) {
          const { messages: turnMsgs, toolResults: turnTr } = realisticSequence(rng, 1, 0);
          allMessages = [...allMessages, ...turnMsgs];
          allToolResults = [...allToolResults, ...turnTr];

          store.saveSync(
            makeSession(sessionId, {
              messageHistory: [...allMessages],
              toolResults: [...allToolResults],
            }),
          );
          await store.flushAll();
        }

        // Add some in-progress messages (no new tool results).
        const ipCount = Math.floor(rng() * 5);
        for (let i = 0; i < ipCount; i++) {
          allMessages = [...allMessages, makeMsg("stream_event", 9000 + i)];
        }
        store.saveSync(
          makeSession(sessionId, {
            messageHistory: [...allMessages],
            toolResults: [...allToolResults],
          }),
        );
        await store.flushAll();

        const loaded = await store.load(sessionId);
        expect(loaded, `seed=${seed}: null`).not.toBeNull();

        // Every tool result key must be present.
        const loadedKeys = new Set((loaded!.toolResults ?? []).map(([k]) => k));
        for (const [key] of allToolResults) {
          expect(loadedKeys.has(key), `seed=${seed}: missing tool result "${key}"`).toBe(true);
        }
        expect(loaded!.toolResults ?? []).toHaveLength(allToolResults.length);
      },
      PROPERTY_TEST_TIMEOUT_MS,
    );
  }

  // ── P5: Freeze boundary is correct ──────────────────────────────────────
  // The number of frozen messages (recorded in hot JSON) equals the index
  // after the last "result" message in the full history.
  it("P5: _frozenCount equals index after last result message", async () => {
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      const rng = mulberry32(seed + 40000);
      const msgCount = 1 + Math.floor(rng() * 30);
      const messages = randomMessageSequence(rng, msgCount);
      const toolResults = toolResultsForMessages(messages);

      const sessionId = `p5-${seed}`;
      const session = makeSession(sessionId, {
        messageHistory: [...messages],
        toolResults: [...toolResults],
      });

      store.saveSync(session);
      await store.flushAll();

      const hotRaw = JSON.parse(readFileSync(join(tempDir, `${sessionId}.json`), "utf-8"));
      const expected = expectedFreezeCutoff(messages);

      expect(hotRaw._frozenCount, `seed=${seed}: _frozenCount=${hotRaw._frozenCount} but expected=${expected}`).toBe(
        expected,
      );
    }
  });

  it("keeps a mutable recovery summary hot until delivered turns finish", async () => {
    // The summary is updated after result handling; freezing its pre-completion form would lose recovered outcome details.
    const sessionId = "mutable-auto-pause-recovery";
    const summary = {
      type: "codex_auto_pause_recovery_summary",
      id: "recovery-summary",
      timestamp: 3,
      content: "Automatic input recovery: 1 delivered.",
      searchText: "automatic input recovery outcome:delivered completion:pending",
      recovery: {
        family: "copilot_auth_refresh_exhausted",
        pausedAt: 1,
        recoveryConfirmedAt: 2,
        updatedAt: 3,
        status: "settled",
        receipts: [
          {
            groupId: "group-1",
            source: "programmatic",
            sourceLabel: "Herd Events",
            count: 1,
            coalescedCount: 0,
            queuedAt: 1,
            lastQueuedAt: 1,
            releasedAt: 2,
            terminalAt: 3,
            outcome: "delivered",
            reasonCode: "codex_delivery_accepted",
            reason: "Accepted by Codex exactly once.",
          },
        ],
      },
    } as BrowserIncomingMessage;
    const messages = [
      { type: "user_message", id: "u1", content: "probe", timestamp: 1 },
      { type: "result", data: { is_error: false } },
      summary,
      { type: "user_message", id: "u2", content: "held event", timestamp: 4 },
      { type: "result", data: { is_error: false } },
    ] as BrowserIncomingMessage[];
    const session = makeSession(sessionId, { messageHistory: messages });

    store.saveSync(session);
    await store.flushAll();
    expect(JSON.parse(readFileSync(join(tempDir, `${sessionId}.json`), "utf-8"))._frozenCount).toBe(2);

    if (summary.type === "codex_auto_pause_recovery_summary") {
      summary.recovery.receipts[0]!.completedAt = 5;
      summary.recovery.receipts[0]!.reasonCode = "codex_delivery_completed";
      summary.recovery.receipts[0]!.reason = "Accepted by Codex exactly once and the turn completed.";
      summary.recovery.updatedAt = 5;
    }
    store.saveSync(session);
    await store.flushAll();
    const reloaded = await store.load(sessionId);
    const reloadedSummary = reloaded?.messageHistory.find(
      (message) => message.type === "codex_auto_pause_recovery_summary",
    );
    expect(reloaded?._frozenCount).toBe(5);
    expect(reloadedSummary?.type).toBe("codex_auto_pause_recovery_summary");
    if (reloadedSummary?.type === "codex_auto_pause_recovery_summary") {
      expect(reloadedSummary.recovery.receipts[0]).toMatchObject({
        completedAt: 5,
        reasonCode: "codex_delivery_completed",
      });
    }
  });

  // ── P6: Crash recovery — JSONL ahead of hot JSON ────────────────────────
  // Simulates a crash between JSONL append and hot JSON write. After
  // recovery, load() must reconstruct the correct history without
  // message duplication or gaps.
  describe("P6: crash recovery — load() deduplicates overlap after partial write", () => {
    let p6TempDir: string;
    const cases = new Map<
      number,
      {
        sessionId: string;
        phase1Msgs: PersistedSession["messageHistory"];
        crashTurnMsgs: PersistedSession["messageHistory"];
        crashTurnTr: NonNullable<PersistedSession["toolResults"]>;
        loaded?: PersistedSession | null;
      }
    >();

    beforeAll(async () => {
      p6TempDir = mkdtempSync(join(tmpdir(), "ss-p6-test-"));
      const p6Store = new SessionStore(p6TempDir);

      for (let seed = 1; seed <= 40; seed++) {
        const rng = mulberry32(seed + 50000);
        const sessionId = `p6-${seed}`;

        // Phase 1: save N completed turns normally.
        const phase1Turns = 1 + Math.floor(rng() * 3);
        const { messages: phase1Msgs, toolResults: phase1Tr } = realisticSequence(rng, phase1Turns, 0);
        const { messages: crashTurnMsgs, toolResults: crashTurnTr } = realisticSequence(rng, 1, 0);

        const session = makeSession(sessionId, {
          messageHistory: [...phase1Msgs],
          toolResults: [...phase1Tr],
        });
        p6Store.saveSync(session);
        cases.set(seed, { sessionId, phase1Msgs, crashTurnMsgs, crashTurnTr });
      }
      await p6Store.flushAll();

      await Promise.all(
        [...cases.values()].map(async (testCase) => {
          // Record the frozen count from the hot JSON before "crash".
          const hotBefore = JSON.parse(await readFile(join(p6TempDir, `${testCase.sessionId}.json`), "utf-8"));

          // Phase 2: manually append one more completed turn to the JSONL,
          // simulating JSONL write succeeded but hot write did not.
          let appendData = "";
          for (const msg of testCase.crashTurnMsgs) {
            appendData += JSON.stringify(msg) + "\n";
          }
          if (testCase.crashTurnTr.length > 0) {
            appendData += JSON.stringify({ _toolResults: testCase.crashTurnTr }) + "\n";
          }

          await appendFile(join(p6TempDir, `${testCase.sessionId}.history.jsonl`), appendData, "utf-8");

          // Hot JSON is stale — it still has the old _frozenCount but contains
          // the crash turn in its hot tail.
          hotBefore.messageHistory = [...testCase.crashTurnMsgs];
          hotBefore.toolResults = [...testCase.crashTurnTr];
          await writeFile(join(p6TempDir, `${testCase.sessionId}.json`), JSON.stringify(hotBefore), "utf-8");
        }),
      );

      await Promise.all(
        [...cases.values()].map(async (testCase) => {
          testCase.loaded = await new SessionStore(p6TempDir).load(testCase.sessionId);
        }),
      );
    }, PROPERTY_TEST_TIMEOUT_MS);

    afterAll(() => {
      if (p6TempDir) rmSync(p6TempDir, { recursive: true, force: true });
    });

    for (let seed = 1; seed <= 40; seed++) {
      it(`seed ${seed}`, async () => {
        const testCase = cases.get(seed);
        expect(testCase, `seed=${seed}: missing prepared crash fixture`).toBeDefined();

        const { loaded, phase1Msgs, crashTurnMsgs } = testCase!;
        expect(loaded, `seed=${seed}: null after crash recovery`).not.toBeNull();

        // Total messages = phase1 + crash turn (no duplicates).
        const expectedTotal = phase1Msgs.length + crashTurnMsgs.length;
        expect(
          loaded!.messageHistory.length,
          `seed=${seed}: expected ${expectedTotal} msgs but got ${loaded!.messageHistory.length}`,
        ).toBe(expectedTotal);

        // Verify ordering: phase1 messages come first, then crash turn.
        for (let i = 0; i < phase1Msgs.length; i++) {
          expect(loaded!.messageHistory[i], `seed=${seed}: phase1 msg[${i}]`).toEqual(phase1Msgs[i]);
        }
        for (let i = 0; i < crashTurnMsgs.length; i++) {
          expect(loaded!.messageHistory[phase1Msgs.length + i], `seed=${seed}: crash msg[${i}]`).toEqual(
            crashTurnMsgs[i],
          );
        }
      });
    }
  });

  // ── P8: Multiple save-load cycles are idempotent ────────────────────────
  // Repeated save → load → save → load cycles must not cause data growth
  // (no duplicate freezing) or corruption.
  for (let seed = 1; seed <= ITERATIONS; seed++) {
    it(
      `P8: repeated save → load → save → load cycles are idempotent (seed ${seed})`,
      async () => {
        const rng = mulberry32(seed + 70000);
        const sessionId = `p8-${seed}`;

        const completedTurns = 1 + Math.floor(rng() * 4);
        const inProgress = Math.floor(rng() * 5);
        const { messages, toolResults } = realisticSequence(rng, completedTurns, inProgress);
        const cycles = 2 + Math.floor(rng() * 3);

        // First save
        const session = makeSession(sessionId, {
          messageHistory: [...messages],
          toolResults: [...toolResults],
        });
        store.saveSync(session);
        await store.flushAll();

        const logPath = join(tempDir, `${sessionId}.history.jsonl`);
        const logAfterFirst = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";

        for (let c = 0; c < cycles; c++) {
          const loaded = await store.load(sessionId);
          expect(loaded, `seed=${seed}, cycle=${c}: null`).not.toBeNull();

          // Verify message count is stable
          expect(loaded!.messageHistory, `seed=${seed}, cycle=${c}: msg count`).toHaveLength(messages.length);
          expect(loaded!.toolResults ?? [], `seed=${seed}, cycle=${c}: tr count`).toHaveLength(toolResults.length);

          // Re-save the loaded session. This must not re-freeze data that
          // was already frozen in the first save.
          store.saveSync(loaded!);
          await store.flushAll();
        }

        // JSONL must not have grown (no duplicate appends).
        const logAfterCycles = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
        expect(logAfterCycles, `seed=${seed}: JSONL grew after ${cycles} cycles`).toBe(logAfterFirst);
      },
      PROPERTY_TEST_TIMEOUT_MS,
    );
  }

  describe("search-data-only archived sessions", () => {
    it("extractSearchExcerpts returns user_message, assistant, and compact_marker content", () => {
      const messages = [
        { type: "user_message", content: "What is the status?", timestamp: 1000, id: "msg-1" },
        {
          type: "assistant",
          message: {
            id: "a1",
            role: "assistant",
            model: "test",
            content: [
              { type: "text", text: "The project is on track." },
              { type: "tool_use", id: "tu-1", name: "Read", input: {} },
            ],
            stop_reason: "end_turn",
            usage: {},
          },
          parent_tool_use_id: null,
          timestamp: 1500,
        },
        { type: "result", data: { type: "result", subtype: "success", uuid: "r1" } },
        { type: "compact_marker", summary: "Discussed project status", timestamp: 2000, id: "cm-1" },
        { type: "user_message", content: "Tell me more", timestamp: 3000, id: "msg-2" },
      ] as PersistedSession["messageHistory"];

      const excerpts = SessionStore.extractSearchExcerpts(messages);
      expect(excerpts).toHaveLength(4);
      expect(excerpts[0]).toMatchObject({ type: "user_message", content: "What is the status?", id: "msg-1" });
      expect(excerpts[1]).toMatchObject({ type: "assistant", content: "The project is on track.", id: "a1" });
      expect(excerpts[2]).toMatchObject({ type: "compact_marker", content: "Discussed project status", id: "cm-1" });
      expect(excerpts[3]).toMatchObject({ type: "user_message", content: "Tell me more", id: "msg-2" });
    });

    it("extractSearchExcerpts preserves session_recycled marker kind", () => {
      const messages = [
        {
          type: "compact_marker",
          markerKind: "session_recycled",
          timestamp: 2000,
          id: "session-recycled-2000",
        },
      ] as PersistedSession["messageHistory"];

      const excerpts = SessionStore.extractSearchExcerpts(messages);

      expect(excerpts).toHaveLength(1);
      expect(excerpts[0]).toMatchObject({
        type: "compact_marker",
        content: "Session recycled",
        markerKind: "session_recycled",
        id: "session-recycled-2000",
      });
    });

    it("extractSearchExcerpts truncates content to 500 chars", () => {
      const longContent = "x".repeat(800);
      const messages = [
        { type: "user_message", content: longContent, timestamp: 1000 },
      ] as PersistedSession["messageHistory"];

      const excerpts = SessionStore.extractSearchExcerpts(messages);
      expect(excerpts[0].content).toHaveLength(500);
    });

    it("setArchived persists _searchExcerpts when archiving", async () => {
      const session = makeSession("archive-test", {
        messageHistory: [
          { type: "user_message", content: "search this text", timestamp: 1000, id: "m1" },
          { type: "result", data: { type: "result", subtype: "success", uuid: "r1" } },
        ] as PersistedSession["messageHistory"],
      });
      store.saveSync(session);
      await store.flushAll();

      await store.setArchived("archive-test", true);
      await store.flushAll();

      const loaded = await store.load("archive-test");
      expect(loaded).not.toBeNull();
      expect(loaded!.archived).toBe(true);
      expect(loaded!._searchExcerpts).toHaveLength(1);
      expect(loaded!._searchExcerpts![0]).toMatchObject({
        type: "user_message",
        content: "search this text",
      });
    });

    it("loadSearchDataOnly returns metadata without messageHistory", async () => {
      // Create a session with history, archive it, then load search-data-only
      const messages = makeTurnMessages(1);
      const session = makeSession("sdo-test", {
        archived: true,
        archivedAt: Date.now(),
        messageHistory: messages,
        taskHistory: [{ title: "Fix bug", timestamp: 1000 }] as any,
        keywords: ["bugfix"],
        _searchExcerpts: [{ type: "user_message" as const, content: "Turn 1 question", timestamp: 1000 }],
      });
      store.saveSync(session);
      await store.flushAll();

      const loaded = await store.loadSearchDataOnly("sdo-test");
      expect(loaded).not.toBeNull();
      expect(loaded!._searchDataOnly).toBe(true);
      expect(loaded!.messageHistory).toHaveLength(0);
      expect(loaded!.toolResults).toHaveLength(0);
      expect(loaded!.taskHistory).toHaveLength(1);
      expect(loaded!.keywords).toEqual(["bugfix"]);
      expect(loaded!._searchExcerpts).toHaveLength(1);
    });

    it("loadAll uses search-data-only for archived, full for active", async () => {
      // Create an active session with history
      const activeMessages = makeTurnMessages(1);
      const activeSession = makeSession("active-sess", {
        messageHistory: activeMessages,
      });
      store.saveSync(activeSession);

      // Create an archived session with history
      const archivedMessages = makeTurnMessages(2);
      const archivedSession = makeSession("archived-sess", {
        archived: true,
        archivedAt: Date.now(),
        messageHistory: archivedMessages,
        _searchExcerpts: [{ type: "user_message" as const, content: "Turn 2 question", timestamp: 2000 }],
      });
      store.saveSync(archivedSession);
      await store.flushAll();

      const all = await store.loadAll();
      const active = all.find((s) => s.id === "active-sess");
      const archived = all.find((s) => s.id === "archived-sess");

      expect(active).not.toBeNull();
      expect(active!.messageHistory.length).toBeGreaterThan(0);
      expect(active!._searchDataOnly).toBeUndefined();

      expect(archived).not.toBeNull();
      expect(archived!.messageHistory).toHaveLength(0);
      expect(archived!._searchDataOnly).toBe(true);
      expect(archived!._searchExcerpts).toHaveLength(1);
    });
  });
});
