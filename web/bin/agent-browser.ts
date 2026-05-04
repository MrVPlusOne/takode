#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { COMPANION_BIN_DIR } from "../server/cli-wrapper-paths.js";
import { optimizeAgentImageFile } from "../server/image-optimizer.js";

const TAKODE_ORIGINAL_FLAG = "--takode-original";
const SCREENSHOT_COMMAND = "screenshot";
const GLOBAL_OPTIONS_WITH_VALUES = new Set([
  "--base-url",
  "--browser",
  "--host",
  "--port",
  "--profile",
  "--session",
  "--storage-state",
  "--target",
  "--timeout",
  "--url",
  "--user-data-dir",
  "--viewport",
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const delegate = await findDelegate();
  if (!delegate) {
    console.error("agent-browser: real agent-browser binary not found outside ~/.companion/bin");
    process.exit(127);
  }

  const screenshotIndex = findScreenshotCommandIndex(args);
  if (screenshotIndex === null) {
    const code = await runDelegate(delegate, args, "inherit");
    process.exit(code);
  }

  const cleanedArgs = args.filter((arg) => arg !== TAKODE_ORIGINAL_FLAG);
  if (args.includes(TAKODE_ORIGINAL_FLAG) || process.env.TAKODE_AGENT_BROWSER_ORIGINAL === "1") {
    const code = await runDelegate(delegate, cleanedArgs, "inherit");
    process.exit(code);
  }

  const callerRequestedJson = hasJsonFlag(cleanedArgs);
  const delegateArgs = callerRequestedJson ? cleanedArgs : [...cleanedArgs, "--json"];
  const result = await runDelegateCaptured(delegate, delegateArgs);
  if (result.code !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.code);
  }

  let payload: AgentBrowserScreenshotPayload;
  try {
    payload = JSON.parse(result.stdout.trim()) as AgentBrowserScreenshotPayload;
  } catch {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    console.error("agent-browser: screenshot delegate did not return JSON, cannot optimize output path");
    process.exit(1);
  }

  const screenshotPath = payload?.data?.path;
  if (!screenshotPath) {
    if (result.stderr) process.stderr.write(result.stderr);
    console.error("agent-browser: screenshot JSON did not include data.path, cannot optimize output path");
    process.exit(1);
  }

  const optimized = await optimizeAgentImageFile(screenshotPath);
  const outputPayload = {
    ...payload,
    data: {
      ...payload.data,
      path: optimized.outputPath,
      originalPath: optimized.inputPath,
      takodeOptimized: {
        outputPath: optimized.outputPath,
        alreadyOptimized: optimized.alreadyOptimized,
        resized: optimized.resized,
        convertedToJpeg: optimized.convertedToJpeg,
        before: optimized.before,
        after: optimized.after,
      },
    },
  };

  if (result.stderr) process.stderr.write(result.stderr);
  if (callerRequestedJson) {
    process.stdout.write(`${JSON.stringify(outputPayload)}\n`);
    return;
  }

  process.stdout.write(`${optimized.outputPath}\n`);
}

interface AgentBrowserScreenshotPayload {
  success?: boolean;
  data?: {
    path?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

async function findDelegate(): Promise<string | null> {
  const entries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const companionBin = await realpath(COMPANION_BIN_DIR).catch(() => resolve(COMPANION_BIN_DIR));
  for (const entry of entries) {
    const resolvedEntry = await realpath(entry).catch(() => resolve(entry));
    if (resolvedEntry === companionBin) continue;
    const candidate = resolve(entry, "agent-browser");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

function hasJsonFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--json" || arg.startsWith("--json="));
}

function findScreenshotCommandIndex(args: string[]): number | null {
  for (let index = 0; index < args.length; ) {
    const arg = args[index];
    if (!arg) return null;
    if (arg === SCREENSHOT_COMMAND) return index;
    if (arg === "--") {
      return args[index + 1] === SCREENSHOT_COMMAND ? index + 1 : null;
    }
    if (arg === TAKODE_ORIGINAL_FLAG) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) return null;
    if (optionTakesValue(arg) && args[index + 1]) {
      index += 2;
      continue;
    }
    index += 1;
  }
  return null;
}

function optionTakesValue(arg: string): boolean {
  if (arg.includes("=")) return false;
  return GLOBAL_OPTIONS_WITH_VALUES.has(arg);
}

function runDelegate(delegate: string, args: string[], stdio: "inherit"): Promise<number> {
  return new Promise((resolveCode) => {
    const child = spawn(delegate, args, { stdio, env: process.env });
    child.on("error", (err) => {
      console.error(`agent-browser: failed to run ${delegate}: ${(err as Error).message}`);
      resolveCode(127);
    });
    child.on("close", (code, signal) => {
      if (signal) resolveCode(128);
      else resolveCode(code ?? 0);
    });
  });
}

function runDelegateCaptured(
  delegate: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult) => {
    const child = spawn(delegate, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      resolveResult({ code: 127, stdout, stderr: `agent-browser: failed to run ${delegate}: ${err.message}\n` });
    });
    child.on("close", (code, signal) => {
      resolveResult({ code: signal ? 128 : (code ?? 0), stdout, stderr });
    });
  });
}

main().catch((err) => {
  console.error(`agent-browser: ${(err as Error).message}`);
  process.exit(1);
});
