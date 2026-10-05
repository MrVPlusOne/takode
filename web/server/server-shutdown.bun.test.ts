import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("exits after a real server-closed WebSocket even when Bun retains the stop promise", async () => {
  // Runs only disposable loopback servers; callbacks replace persistence and snapshot deletion.
  // The child reports the actual bug shape before exercising the production shutdown controller.
  const modulePath = fileURLToPath(new URL("./server-shutdown.ts", import.meta.url));
  const script = `
    import { ServerShutdown } from ${JSON.stringify(modulePath)};
    let socket;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
      fetch: (req, s) => s.upgrade(req) ? undefined : new Response("test"),
      websocket: { idleTimeout: 0, perMessageDeflate: true, open(ws) { socket = ws; }, message() {}, close() {} }
    });
    const client = new WebSocket("ws://127.0.0.1:" + server.port);
    await new Promise(r => client.addEventListener("open", r));
    const closed = new Promise(r => client.addEventListener("close", r));
    socket.close(1001, "test shutdown");
    await closed;
    const stages = [];
    let saved = false;
    let stopped = false;
    let cleaned = false;
    const shutdown = new ServerShutdown({
      stopWork: () => { stopped = true; }, settleWork: async () => {},
      cancelFrontendPreparation: async () => {}, stopListener: () => server.stop(true),
      persist: async () => { if (!stopped) throw new Error("work still active"); saved = true; },
      cleanupFrontend: async () => { cleaned = true; }, flushLogs: async () => {},
      log: (message, details) => stages.push({message, ...details}), stageTimeoutMs: 50,
      exit: code => { console.log(JSON.stringify({ code, saved, stopped, cleaned, stages })); process.exit(0); }
    });
    await shutdown.request(42);
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-install", "-e", script], { timeout: 5_000 });
  const result = JSON.parse(stdout.trim());
  expect(result).toMatchObject({ code: 42, saved: true, stopped: true });
  const timedOut = result.stages.some(
    (stage: { message: string; stage: string }) => stage.stage === "listener" && stage.message.includes("timed out"),
  );
  // Newer Bun may fix its socket accounting. Snapshot deletion is allowed only for a settled listener.
  expect(result.cleaned).toBe(!timedOut);
});
